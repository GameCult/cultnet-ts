import { createSocket, type RemoteInfo, type Socket as DgramSocket } from "node:dgram";
import { connect as connectTcp, createServer, type Server, type Socket as TcpSocket } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import process from "node:process";
import { setTimeout as delay } from "node:timers/promises";

import { decode, encode } from "@msgpack/msgpack";
import { CultCache, SingleFileMessagePackBackingStore, defineDocumentType } from "cultcache-ts";
import {
  CultNetDocumentRegistry,
  CultNetPeer,
  CultNetSchemaRegistry,
  cultNetBuiltinSchemaRegistry,
  defineCultNetDocumentBinding,
  type CultNetMessage,
  type CultNetSchemaCatalogRequestMessage,
  type CultNetSchemaCatalogResponseMessage,
  type CultNetSnapshotRequestMessage,
  type CultNetSnapshotResponseRawMessage,
} from "../../src";
import {
  DISCOVERY_ANNOUNCE_SCHEMA_VERSION,
  DISCOVERY_PROBE_SCHEMA_VERSION,
  INTEROP_DOCUMENT_TYPE,
  INTEROP_SCHEMA_VERSION,
  INTEROP_WIRE_CONTRACT,
  buildInteropNote,
  createInteropFormatter,
  discoveryAnnounceSchema,
  discoveryProbeSchema,
  interopNoteSchema,
  loadInteropSchemaRegistration,
  optionalIntArg,
  parseArgs,
  requireArg,
  type DiscoveryAnnounce,
  type DiscoveryProbe,
  type InteropNote,
} from "./cultnet-interop-shared";

async function main(): Promise<void> {
  const [mode, ...rest] = process.argv.slice(2);
  if (!mode) {
    throw new Error("Expected mode: serve | probe | dial");
  }

  const args = parseArgs(rest);

  switch (mode) {
    case "serve":
      await serve(args);
      return;
    case "probe":
      await probe(args);
      return;
    case "dial":
      await dial(args);
      return;
    default:
      throw new Error(`Unknown mode ${mode}`);
  }
}

async function serve(args: Map<string, string>): Promise<void> {
  const runtimeId = requireArg(args, "runtime-id");
  const runtimeKind = requireArg(args, "runtime-kind");
  const displayName = requireArg(args, "display-name");
  const agentId = requireArg(args, "agent-id");
  const advertiseHost = requireArg(args, "advertise-host");
  const bindHost = args.get("bind-host") ?? "127.0.0.1";
  const tcpPort = optionalIntArg(args, "tcp-port");
  const discoveryPort = optionalIntArg(args, "discovery-port");
  const discoveryGroup = requireArg(args, "discovery-group");
  const schemaPath = requireArg(args, "schema-path");

  if (!tcpPort || !discoveryPort) {
    throw new Error("serve mode requires --tcp-port and --discovery-port");
  }

  const interopSchema = await loadInteropSchemaRegistration(schemaPath);
  const noteDocument = defineDocumentType({
    type: INTEROP_DOCUMENT_TYPE,
    schema: interopNoteSchema,
    formatter: createInteropFormatter(),
  });
  const cache = CultCache.builder()
    .withDocumentType(noteDocument)
    .withGenericStore(new SingleFileMessagePackBackingStore(runtimeStorePath(runtimeId)))
    .build();
  const documentRegistry = new CultNetDocumentRegistry([
    defineCultNetDocumentBinding({
      definition: noteDocument,
      payloadSchemaVersion: INTEROP_SCHEMA_VERSION,
    }),
  ]);
  const customSchemas = new CultNetSchemaRegistry([
    {
      schemaId: interopSchema.schemaId,
      kind: "document_payload",
      schema: interopSchema.schema,
      schemaVersion: INTEROP_SCHEMA_VERSION,
      documentType: INTEROP_DOCUMENT_TYPE,
      title: interopSchema.title,
      wireContracts: [INTEROP_WIRE_CONTRACT],
    },
  ]);

  await cache.put(noteDocument, `note:${runtimeId}`, buildInteropNote(runtimeId, displayName));

  const tcpServer = createServer();
  tcpServer.on("connection", (socket) => {
    const peer = new CultNetPeer(socket, { wireContract: INTEROP_WIRE_CONTRACT });
    peer.on("invalidMessage", (error) => writeLog("invalidMessage", { runtimeId, error: error.message }));
    peer.on("error", (error) => writeLog("tcpError", { runtimeId, error: error.message }));
    peer.on("message", async (message) => {
      try {
        await handleServerMessage({
          peer,
          message,
          runtimeId,
          runtimeKind,
          displayName,
          agentId,
          cache,
          documentRegistry,
          customSchemas,
        });
      } catch (error) {
        writeLog("serveMessageError", {
          runtimeId,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    });
  });

  const udpSocket = createSocket({ type: "udp4", reuseAddr: true });
  udpSocket.on("error", (error) => writeLog("udpError", { runtimeId, error: error.message }));
  udpSocket.on("message", (packet, remote) => {
    try {
      const probeMessage = discoveryProbeSchema.parse(decode(packet));
      void respondToProbe({
        socket: udpSocket,
        remote,
        probeMessage,
        runtimeId,
        runtimeKind,
        displayName,
        agentId,
        advertiseHost,
        tcpPort,
      });
    } catch {
      // ignore unrelated multicast noise instead of becoming dramatic about it
    }
  });

  await Promise.all([
    new Promise<void>((resolve, reject) => {
      tcpServer.once("error", reject);
      tcpServer.listen(tcpPort, bindHost, () => resolve());
    }),
    new Promise<void>((resolve, reject) => {
      udpSocket.once("error", reject);
      udpSocket.bind(discoveryPort, "0.0.0.0", () => {
        udpSocket.addMembership(discoveryGroup);
        udpSocket.setMulticastTTL(1);
        udpSocket.setMulticastLoopback(true);
        resolve();
      });
    }),
  ]);

  writeJsonLine({
    status: "ready",
    mode: "serve",
    runtimeId,
    runtimeKind,
    tcpPort,
    discoveryPort,
    discoveryGroup,
  });

  await waitForTermination(async () => {
    udpSocket.close();
    await closeServer(tcpServer);
  });
}

async function handleServerMessage(input: {
  peer: CultNetPeer;
  message: CultNetMessage;
  runtimeId: string;
  runtimeKind: string;
  displayName: string;
  agentId: string;
  cache: CultCache;
  documentRegistry: CultNetDocumentRegistry;
  customSchemas: CultNetSchemaRegistry;
}): Promise<void> {
  const {
    peer,
    message,
    runtimeId,
    runtimeKind,
    displayName,
    agentId,
    cache,
    documentRegistry,
    customSchemas,
  } = input;

  switch (message.schemaVersion) {
    case "cultnet.hello.v0":
      peer.sendHello({
        schemaVersion: "cultnet.hello.v0",
        runtimeId,
        runtimeKind,
        agentId,
        displayName,
        supportedDocumentTypes: [INTEROP_DOCUMENT_TYPE],
        supportedMessageVersions: [INTEROP_SCHEMA_VERSION],
        supportsSchemaCatalog: true,
      });
      break;
    case "cultnet.schema_catalog_request.v0":
      peer.sendSchemaCatalogResponse(createCatalogResponse(customSchemas, message));
      break;
    case "cultnet.snapshot_request.v0":
      peer.send(documentRegistry.createRawSnapshotResponse(cache, message.messageId, message));
      break;
    default:
      break;
  }
}

function createCatalogResponse(
  customSchemas: CultNetSchemaRegistry,
  request: CultNetSchemaCatalogRequestMessage,
): CultNetSchemaCatalogResponseMessage {
  const builtIn = cultNetBuiltinSchemaRegistry.list({
    includeSchemaJson: request.includeSchemaJson,
    schemaIds: request.schemaIds,
    kinds: request.kinds,
  });
  const custom = customSchemas.list({
    includeSchemaJson: request.includeSchemaJson,
    schemaIds: request.schemaIds,
    kinds: request.kinds,
  });
  const schemas = [...builtIn];
  for (const entry of custom) {
    if (!schemas.some((candidate) => candidate.schemaId === entry.schemaId)) {
      schemas.push(entry);
    }
  }

  return {
    schemaVersion: "cultnet.schema_catalog_response.v0",
    messageId: request.messageId,
    schemas,
  };
}

async function respondToProbe(input: {
  socket: DgramSocket;
  remote: RemoteInfo;
  probeMessage: DiscoveryProbe;
  runtimeId: string;
  runtimeKind: string;
  displayName: string;
  agentId: string;
  advertiseHost: string;
  tcpPort: number;
}): Promise<void> {
  const {
    socket,
    remote,
    probeMessage,
    runtimeId,
    runtimeKind,
    displayName,
    agentId,
    advertiseHost,
    tcpPort,
  } = input;

  const announceMessage: DiscoveryAnnounce = {
    schemaVersion: DISCOVERY_ANNOUNCE_SCHEMA_VERSION,
    messageId: probeMessage.messageId,
    runtimeId,
    runtimeKind,
    displayName,
    agentId,
    tcpHost: advertiseHost,
    tcpPort,
    wireContract: INTEROP_WIRE_CONTRACT,
    supportedDocumentTypes: [INTEROP_DOCUMENT_TYPE],
    supportsSchemaCatalog: true,
  };

  await new Promise<void>((resolve, reject) => {
    socket.send(encode(announceMessage), remote.port, remote.address, (error) => {
      if (error) {
        reject(error);
        return;
      }

      resolve();
    });
  });
}

async function probe(args: Map<string, string>): Promise<void> {
  const runtimeId = requireArg(args, "runtime-id");
  const discoveryPort = optionalIntArg(args, "discovery-port");
  const discoveryGroup = requireArg(args, "discovery-group");
  const timeoutMs = optionalIntArg(args, "timeout-ms", 1500) ?? 1500;

  if (!discoveryPort) {
    throw new Error("probe mode requires --discovery-port");
  }

  const socket = createSocket({ type: "udp4", reuseAddr: true });
  const messageId = `${runtimeId}-${Date.now()}`;
  const found = new Map<string, DiscoveryAnnounce>();

  socket.on("message", (packet) => {
    try {
      const announce = discoveryAnnounceSchema.parse(decode(packet));
      if (announce.messageId === messageId) {
        found.set(announce.runtimeId, announce);
      }
    } catch {
      // ignore unrelated packets
    }
  });

  await new Promise<void>((resolve, reject) => {
    socket.once("error", reject);
    socket.bind(0, "0.0.0.0", () => {
      socket.setMulticastTTL(1);
      socket.setMulticastLoopback(true);
      resolve();
    });
  });

  const probeMessage: DiscoveryProbe = {
    schemaVersion: DISCOVERY_PROBE_SCHEMA_VERSION,
    messageId,
    requesterRuntimeId: runtimeId,
  };

  await new Promise<void>((resolve, reject) => {
    socket.send(encode(probeMessage), discoveryPort, discoveryGroup, (error) => {
      if (error) {
        reject(error);
        return;
      }

      resolve();
    });
  });

  await delay(timeoutMs);
  socket.close();

  writeJsonLine({
    mode: "probe",
    runtimeId,
    peers: [...found.values()].sort((left, right) => left.runtimeId.localeCompare(right.runtimeId)),
  });
}

async function dial(args: Map<string, string>): Promise<void> {
  const runtimeId = requireArg(args, "runtime-id");
  const runtimeKind = requireArg(args, "runtime-kind");
  const displayName = requireArg(args, "display-name");
  const agentId = requireArg(args, "agent-id");
  const targetHost = requireArg(args, "target-host");
  const targetPort = optionalIntArg(args, "target-port");
  const schemaPath = requireArg(args, "schema-path");
  const timeoutMs = optionalIntArg(args, "timeout-ms", 4000) ?? 4000;

  if (!targetPort) {
    throw new Error("dial mode requires --target-port");
  }

  const interopSchema = await loadInteropSchemaRegistration(schemaPath);
  const noteDocument = defineDocumentType({
    type: INTEROP_DOCUMENT_TYPE,
    schema: interopNoteSchema,
    formatter: createInteropFormatter(),
  });
  const cache = CultCache.builder()
    .withDocumentType(noteDocument)
    .withGenericStore(new SingleFileMessagePackBackingStore(runtimeStorePath(`${runtimeId}-dial`)))
    .build();
  const documentRegistry = new CultNetDocumentRegistry([
    defineCultNetDocumentBinding({
      definition: noteDocument,
      payloadSchemaVersion: INTEROP_SCHEMA_VERSION,
    }),
  ]);

  const socket = await connectTo(targetHost, targetPort);
  const peer = new CultNetPeer(socket, { wireContract: INTEROP_WIRE_CONTRACT });

  peer.sendHello({
    schemaVersion: "cultnet.hello.v0",
    runtimeId,
    runtimeKind,
    agentId,
    displayName,
    supportedDocumentTypes: [INTEROP_DOCUMENT_TYPE],
    supportedMessageVersions: [INTEROP_SCHEMA_VERSION],
    supportsSchemaCatalog: true,
  });
  const remoteHello = await waitForMessage(peer, (message) => message.schemaVersion === "cultnet.hello.v0", timeoutMs);

  const catalogRequest: CultNetSchemaCatalogRequestMessage = {
    schemaVersion: "cultnet.schema_catalog_request.v0",
    messageId: `${runtimeId}-catalog`,
    includeSchemaJson: true,
  };
  peer.sendSchemaCatalogRequest(catalogRequest);
  const catalogResponse = await waitForMessage(peer, (message) => message.schemaVersion === "cultnet.schema_catalog_response.v0", timeoutMs);

  const snapshotRequest: CultNetSnapshotRequestMessage = {
    schemaVersion: "cultnet.snapshot_request.v0",
    messageId: `${runtimeId}-snapshot`,
    documentTypes: [INTEROP_DOCUMENT_TYPE],
  };
  peer.sendSnapshotRequest(snapshotRequest);
  const snapshotResponse = await waitForMessage(peer, (message) => message.schemaVersion === "cultnet.snapshot_response_raw.v0", timeoutMs);

  await documentRegistry.applyRawSnapshotResponse(cache, snapshotResponse as CultNetSnapshotResponseRawMessage);
  const note = cache.getRequired(noteDocument, `note:${(remoteHello as { runtimeId: string }).runtimeId}`);
  const hasInteropSchema = (catalogResponse as CultNetSchemaCatalogResponseMessage).schemas.some(
    (schema) => schema.schemaId === interopSchema.schemaId && schema.documentType === INTEROP_DOCUMENT_TYPE,
  );

  peer.close();

  writeJsonLine({
    mode: "dial",
    runtimeId,
    targetHost,
    targetPort,
    remoteHello,
    hasInteropSchema,
    retrievedNote: note,
  });
}

function waitForMessage<TMessage extends CultNetMessage>(
  peer: CultNetPeer,
  predicate: (message: CultNetMessage) => message is TMessage,
  timeoutMs: number,
): Promise<TMessage> {
  return new Promise<TMessage>((resolve, reject) => {
    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error(`Timed out waiting for CultNet message after ${timeoutMs}ms.`));
    }, timeoutMs);

    const onMessage = (message: CultNetMessage) => {
      if (!predicate(message)) {
        return;
      }

      cleanup();
      resolve(message);
    };

    const onInvalid = (error: Error) => {
      cleanup();
      reject(error);
    };

    const cleanup = () => {
      clearTimeout(timeout);
      peer.off("message", onMessage);
      peer.off("invalidMessage", onInvalid);
    };

    peer.on("message", onMessage);
    peer.on("invalidMessage", onInvalid);
  });
}

async function connectTo(host: string, port: number): Promise<TcpSocket> {
  return new Promise<TcpSocket>((resolve, reject) => {
    const socket = connectTcp(port, host);
    socket.once("connect", () => resolve(socket));
    socket.once("error", reject);
  });
}

async function closeServer(server: Server): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }

      resolve();
    });
  });
}

async function waitForTermination(cleanup: () => Promise<void>): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    let closed = false;
    const finish = async (signal: NodeJS.Signals) => {
      if (closed) {
        return;
      }

      closed = true;
      try {
        await cleanup();
        writeLog("shutdown", { signal });
        resolve();
      } catch (error) {
        reject(error);
      }
    };

    process.once("SIGTERM", () => void finish("SIGTERM"));
    process.once("SIGINT", () => void finish("SIGINT"));
  });
}

function writeJsonLine(value: unknown): void {
  process.stdout.write(`${JSON.stringify(value)}\n`);
}

function writeLog(event: string, payload: Record<string, unknown>): void {
  process.stderr.write(`${JSON.stringify({ event, ...payload })}\n`);
}

function runtimeStorePath(runtimeId: string): string {
  return join(tmpdir(), `cultnet-ts-interop-${runtimeId}.msgpack`);
}

main().catch((error) => {
  writeLog("fatal", { error: error instanceof Error ? error.stack ?? error.message : String(error) });
  process.exitCode = 1;
});
