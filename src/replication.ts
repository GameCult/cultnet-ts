import { decode, encode } from "@msgpack/msgpack";
import type {
  AnyCultCacheDocumentDefinition,
  CultCache,
  CultCacheDocumentDefinition,
  CultCacheDocumentFormatter,
  CultCacheDocumentValue,
  CultCacheEnvelope,
} from "cultcache-ts";

import {
  type CultNetDocumentDeleteMessage,
  type CultNetDocumentPutMessage,
  type CultNetDocumentPutRawMessage,
  type CultNetDocumentRecord,
  type CultNetRawDocumentRecord,
  type CultNetSnapshotRequestMessage,
  type CultNetSnapshotResponseMessage,
  type CultNetSnapshotResponseRawMessage,
} from "./contracts";

export interface CultNetDocumentBinding<
  TDefinition extends AnyCultCacheDocumentDefinition = AnyCultCacheDocumentDefinition,
> {
  definition: TDefinition;
  payloadSchemaVersion?:
    | string
    | ((value: CultCacheDocumentValue<TDefinition>) => string | undefined);
}

export function defineCultNetDocumentBinding<
  TDefinition extends AnyCultCacheDocumentDefinition,
>(
  binding: CultNetDocumentBinding<TDefinition>,
): CultNetDocumentBinding<TDefinition> {
  return Object.freeze({ ...binding });
}

export class CultNetDocumentRegistry {
  readonly #bindings = new Map<string, CultNetDocumentBinding>();

  constructor(bindings: Iterable<CultNetDocumentBinding> = []) {
    for (const binding of bindings) {
      this.register(binding);
    }
  }

  register(binding: CultNetDocumentBinding): this {
    this.#bindings.set(binding.definition.type, binding);
    return this;
  }

  get(documentType: string): CultNetDocumentBinding | undefined {
    return this.#bindings.get(documentType);
  }

  createDocumentPutMessage<TDefinition extends AnyCultCacheDocumentDefinition>(
    binding: CultNetDocumentBinding<TDefinition>,
    messageId: string,
    documentKey: string,
    value: CultCacheDocumentValue<TDefinition>,
    options: {
      storedAt?: string;
      sourceRuntimeId?: string;
      sourceAgentId?: string;
      sourceRole?: string;
      tags?: string[];
    } = {},
  ): CultNetDocumentPutMessage<CultCacheDocumentValue<TDefinition>> {
    const parsed = binding.definition.schema.parse(value);
    return {
      schemaVersion: "cultnet.document_put.v0",
      messageId,
      document: {
        documentType: binding.definition.type,
        documentKey,
        storedAt: options.storedAt ?? new Date().toISOString(),
        payloadSchemaVersion: resolvePayloadSchemaVersion(binding, parsed),
        payload: parsed,
        sourceRuntimeId: options.sourceRuntimeId,
        sourceAgentId: options.sourceAgentId,
        sourceRole: options.sourceRole,
        tags: options.tags,
      },
    };
  }

  createDocumentDeleteMessage(
    messageId: string,
    documentType: string,
    documentKey: string,
  ): CultNetDocumentDeleteMessage {
    return {
      schemaVersion: "cultnet.document_delete.v0",
      messageId,
      documentType,
      documentKey,
    };
  }

  createRawDocumentPutMessageFromEnvelope(
    messageId: string,
    envelope: CultCacheEnvelope,
  ): CultNetDocumentPutRawMessage {
    return {
      schemaVersion: "cultnet.document_put_raw.v0",
      messageId,
      document: this.#createRawDocumentRecord(envelope),
    };
  }

  createSnapshotResponse(
    cache: CultCache,
    messageId: string,
    filter?: CultNetSnapshotRequestMessage,
  ): CultNetSnapshotResponseMessage {
    const requestedTypes = filter?.documentTypes ? new Set(filter.documentTypes) : undefined;
    const requestedKeys = filter?.documentKeys ? new Set(filter.documentKeys) : undefined;
    const documents: CultNetDocumentRecord[] = [];

    for (const envelope of cache.snapshot()) {
      if (requestedTypes && !requestedTypes.has(envelope.type)) {
        continue;
      }

      if (requestedKeys && !requestedKeys.has(envelope.key)) {
        continue;
      }

      const binding = this.#requireBinding(envelope.type);
      const payload = decodeDocumentValue(binding.definition, envelope.payload);
      documents.push({
        documentType: envelope.type,
        documentKey: envelope.key,
        storedAt: envelope.storedAt,
        payloadSchemaVersion: resolvePayloadSchemaVersion(binding, payload),
        payload,
      });
    }

    return {
      schemaVersion: "cultnet.snapshot_response.v0",
      messageId,
      documents,
    };
  }

  createRawSnapshotResponse(
    cache: CultCache,
    messageId: string,
    filter?: CultNetSnapshotRequestMessage,
  ): CultNetSnapshotResponseRawMessage {
    const requestedTypes = filter?.documentTypes ? new Set(filter.documentTypes) : undefined;
    const requestedKeys = filter?.documentKeys ? new Set(filter.documentKeys) : undefined;
    const documents: CultNetRawDocumentRecord[] = [];

    for (const envelope of cache.snapshot()) {
      if (requestedTypes && !requestedTypes.has(envelope.type)) {
        continue;
      }

      if (requestedKeys && !requestedKeys.has(envelope.key)) {
        continue;
      }

      documents.push(this.#createRawDocumentRecord(envelope));
    }

    return {
      schemaVersion: "cultnet.snapshot_response_raw.v0",
      messageId,
      documents,
    };
  }

  async applyDocumentPutMessage(
    cache: CultCache,
    message: CultNetDocumentPutMessage,
  ): Promise<unknown> {
    const binding = this.#requireBinding(message.document.documentType);
    return cache.put(
      binding.definition,
      message.document.documentKey,
      binding.definition.schema.parse(message.document.payload),
    );
  }

  async applyDocumentDeleteMessage(
    cache: CultCache,
    message: CultNetDocumentDeleteMessage,
  ): Promise<boolean> {
    const binding = this.#requireBinding(message.documentType);
    return cache.delete(binding.definition, message.documentKey);
  }

  async applyRawDocumentPutMessage(
    cache: CultCache,
    message: CultNetDocumentPutRawMessage,
  ): Promise<unknown> {
    const binding = this.#requireBinding(message.document.documentType);
    return cache.putEnvelope(binding.definition, {
      key: message.document.documentKey,
      type: message.document.documentType,
      payload: new Uint8Array(message.document.payload),
      storedAt: message.document.storedAt,
    });
  }

  async applySnapshotResponse(
    cache: CultCache,
    response: CultNetSnapshotResponseMessage,
  ): Promise<void> {
    for (const document of response.documents) {
      await this.applyDocumentPutMessage(cache, {
        schemaVersion: "cultnet.document_put.v0",
        messageId: response.messageId,
        document,
      });
    }
  }

  async applyRawSnapshotResponse(
    cache: CultCache,
    response: CultNetSnapshotResponseRawMessage,
  ): Promise<void> {
    for (const document of response.documents) {
      await this.applyRawDocumentPutMessage(cache, {
        schemaVersion: "cultnet.document_put_raw.v0",
        messageId: response.messageId,
        document,
      });
    }
  }

  #requireBinding(documentType: string): CultNetDocumentBinding {
    const binding = this.get(documentType);
    if (!binding) {
      throw new Error(`No CultNet document binding is registered for "${documentType}".`);
    }

    return binding;
  }

  #createRawDocumentRecord(envelope: CultCacheEnvelope): CultNetRawDocumentRecord {
    const binding = this.#requireBinding(envelope.type);
    return {
      documentType: envelope.type,
      documentKey: envelope.key,
      storedAt: envelope.storedAt,
      payloadSchemaVersion: typeof binding.payloadSchemaVersion === "string"
        ? binding.payloadSchemaVersion
        : undefined,
      payloadEncoding: "messagepack",
      payload: new Uint8Array(envelope.payload),
    };
  }
}

function resolvePayloadSchemaVersion<TDefinition extends AnyCultCacheDocumentDefinition>(
  binding: CultNetDocumentBinding<TDefinition>,
  value: CultCacheDocumentValue<TDefinition>,
): string | undefined {
  if (typeof binding.payloadSchemaVersion === "function") {
    return binding.payloadSchemaVersion(value);
  }

  return binding.payloadSchemaVersion;
}

function decodeDocumentValue<TDefinition extends CultCacheDocumentDefinition>(
  definition: TDefinition,
  payload: Uint8Array,
): CultCacheDocumentValue<TDefinition> {
  const formatter: CultCacheDocumentFormatter<CultCacheDocumentValue<TDefinition>> =
    (definition.formatter as CultCacheDocumentFormatter<
      CultCacheDocumentValue<TDefinition>
    > | undefined) ?? {
    encode: (value: CultCacheDocumentValue<TDefinition>) => encode(value),
    decode: (bytes: Uint8Array) => decode(bytes) as CultCacheDocumentValue<TDefinition>,
  };
  const decoded = formatter.decode(payload);
  return definition.schema.parse(decoded) as CultCacheDocumentValue<TDefinition>;
}
