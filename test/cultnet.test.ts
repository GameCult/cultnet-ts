import test from "node:test";
import assert from "node:assert/strict";
import { Duplex } from "node:stream";
import { rmSync, mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { z } from "zod";
import {
  CultCache,
  SingleFileMessagePackBackingStore,
  defineDocumentType,
} from "cultcache-ts";

import {
  CultNetClientSecurityOptions,
  CultNetDocumentRegistry,
  CultNetPeer,
  CultNetSecret,
  CultNetServerSecurityOptions,
  defineCultNetDocumentBinding,
  encodeCultNetMessageForWire,
  ghostlightAgentStateGeneratedContract,
  parseCultNetMessage,
  validateGhostlightAgentStateGenerated,
  validateGhostlightAgentState,
  type CultNetLoginMessage,
  type GhostlightAgentStateShape,
  type GhostlightAgentStateDocument,
} from "../src";

class LinkedDuplex extends Duplex {
  peer?: LinkedDuplex;

  // eslint-disable-next-line @typescript-eslint/no-empty-function
  _read(): void {}

  _write(
    chunk: Buffer,
    _encoding: BufferEncoding,
    callback: (error?: Error | null) => void,
  ): void {
    this.peer?.push(Buffer.from(chunk));
    callback();
  }

  _final(callback: (error?: Error | null) => void): void {
    this.peer?.push(null);
    callback();
  }
}

function createDuplexPair(): { a: Duplex; b: Duplex } {
  const a = new LinkedDuplex();
  const b = new LinkedDuplex();
  a.peer = b;
  b.peer = a;
  return { a, b };
}

test("CultNet secret helpers round-trip encrypted strings and validate sessions", () => {
  const serverSecurity = CultNetServerSecurityOptions.development();
  const clientSecurity = serverSecurity.toClientOptions();
  const nonce = CultNetSecret.newNonce();
  const encrypted = CultNetSecret.encryptString("hello", nonce, clientSecurity);
  assert.ok(encrypted);
  assert.equal(CultNetSecret.decryptString(encrypted, nonce, serverSecurity), "hello");

  const token = CultNetSecret.createSessionToken(
    "runtime-face",
    new Date(Date.now() + 60_000),
    serverSecurity,
  );
  const validated = CultNetSecret.tryValidateSessionToken(token, serverSecurity);
  assert.ok(validated);
  assert.equal(validated?.userId, "runtime-face");
});

test("CultNet peer frames and decodes typed messages over a direct pipe", async () => {
  const { a, b } = createDuplexPair();
  const sender = new CultNetPeer(a, { wireContract: "cultnet.schema.v0" });
  const receiver = new CultNetPeer(b, { wireContract: "cultnet.schema.v0" });

  const message = await new Promise<ReturnType<typeof parseCultNetMessage>>((resolve, reject) => {
    receiver.once("message", resolve);
    receiver.once("invalidMessage", reject);
    sender.sendHello({
      schemaVersion: "cultnet.hello.v0",
      runtimeId: "voidbot-main",
      runtimeKind: "node-worker",
      agentId: "void",
      displayName: "Void",
      supportedDocumentTypes: ["ghostlight.agent-state"],
    });
  });

  assert.equal(message.schemaVersion, "cultnet.hello.v0");
  if (message.schemaVersion === "cultnet.hello.v0") {
    assert.equal(message.runtimeId, "voidbot-main");
    assert.equal(message.agentId, "void");
  }

  sender.close();
  receiver.close();
});

test("CultNet can round-trip gamecult.networking.v0 auth messages through the explicit legacy contract", () => {
  const message: CultNetLoginMessage = {
    schemaVersion: "cultnet.login.v0",
    nonce: "bm9uY2U",
    auth: "YXV0aA",
    password: "cGFzc3dvcmQ",
  };

  const wireValue = encodeCultNetMessageForWire(message, "gamecult.networking.v0");
  assert.deepEqual(wireValue, [
    0,
    [
      Buffer.from("nonce", "utf8"),
      Buffer.from("auth", "utf8"),
      Buffer.from("password", "utf8"),
    ],
  ]);

  const decoded = parseCultNetMessage(wireValue, "gamecult.networking.v0");
  assert.deepEqual(decoded, message);
});

test("CultNet document registry builds snapshots and applies document puts through CultCache", async () => {
  const tempDir = mkdtempSync(join(tmpdir(), "cultnetts-"));

  try {
    const documentDefinition = defineDocumentType({
      type: "ghostlight.agent-state",
      schema: z.custom<GhostlightAgentStateDocument>((value) => {
        try {
          validateGhostlightAgentState(value);
          return true;
        } catch {
          return false;
        }
      }),
    });

    const registry = new CultNetDocumentRegistry([
      defineCultNetDocumentBinding({
        definition: documentDefinition,
        payloadSchemaVersion: "ghostlight.agent_state.v0",
      }),
    ]);

    const originStore = new SingleFileMessagePackBackingStore(join(tempDir, "origin.msgpack"));
    const targetStore = new SingleFileMessagePackBackingStore(join(tempDir, "target.msgpack"));
    const originCache = CultCache.builder()
      .withDocumentType(documentDefinition)
      .withGenericStore(originStore)
      .build();
    const targetCache = CultCache.builder()
      .withDocumentType(documentDefinition)
      .withGenericStore(targetStore)
      .build();

    const payload = validateGhostlightAgentState({
      schema_version: "ghostlight.agent_state.v0",
      world: {
        world_id: "epiphany-face",
        setting: "test harness",
        time: { label: "now" },
        canon_context: ["test"],
      },
      agents: [
        {
          agent_id: "epiphany.face",
          identity: {
            name: "Face",
            roles: ["public-surface"],
            origin: "test",
            public_description: "test",
          },
          canonical_state: {
            underlying_organization: {},
            stable_dispositions: {},
            behavioral_dimensions: {},
            presentation_strategy: {},
            voice_style: {},
            situational_state: {},
            values: [],
          },
          goals: [],
          memories: {
            episodic: [],
            semantic: [],
            relationship_summaries: [],
          },
          perceived_state_overlays: [],
        },
      ],
      relationships: [],
      events: [],
      scenes: [],
    });

    await originCache.put(documentDefinition, "epiphany.face", payload);
    const snapshot = registry.createSnapshotResponse(originCache, "snapshot-1");
    await registry.applySnapshotResponse(targetCache, snapshot);

    const roundTrip = targetCache.get(documentDefinition, "epiphany.face");
    assert.ok(roundTrip);
    assert.equal(roundTrip?.schema_version, "ghostlight.agent_state.v0");
    assert.equal(roundTrip?.agents[0]?.agent_id, "epiphany.face");
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("Ghostlight contract mirror rejects nested payloads that violate the canonical schema", () => {
  assert.throws(
    () => validateGhostlightAgentState({
      schema_version: "ghostlight.agent_state.v0",
      world: {
        world_id: "ghostlight-lab",
        setting: "test",
        time: { label: "now" },
        canon_context: ["test"],
      },
      agents: [
        {
          identity: {
            name: "Face",
            roles: ["public-surface"],
            origin: "test",
            public_description: "test",
          },
          canonical_state: {
            underlying_organization: {},
            stable_dispositions: {},
            behavioral_dimensions: {},
            presentation_strategy: {},
            voice_style: {},
            situational_state: {},
            values: [],
          },
          goals: [],
          memories: {
            episodic: [],
            semantic: [],
            relationship_summaries: [],
          },
          perceived_state_overlays: [],
        },
      ],
      relationships: [],
      events: [],
      scenes: [],
    }),
    /agent_id/u,
  );
});

test("Generated Ghostlight contracts can feed CultCacheTS directly without a Zod mirror", async () => {
  const tempDir = mkdtempSync(join(tmpdir(), "cultnetts-generated-"));

  try {
    const documentDefinition = defineDocumentType({
      type: "ghostlight.agent-state.generated",
      schema: ghostlightAgentStateGeneratedContract,
      global: true,
    });

    const store = new SingleFileMessagePackBackingStore(join(tempDir, "generated.msgpack"));
    const cache = CultCache.builder()
      .withDocumentType(documentDefinition)
      .withGenericStore(store)
      .build();

    const payload: GhostlightAgentStateShape = {
      schema_version: "ghostlight.agent_state.v0",
      world: {
        world_id: "ghostlight-lab",
        setting: "test harness",
        time: { label: "now" },
        canon_context: ["test"],
      },
      agents: [
        {
          agent_id: "void",
          identity: {
            name: "Void",
            roles: ["observer"],
            origin: "test",
            public_description: "test",
          },
          canonical_state: {
            underlying_organization: {},
            stable_dispositions: {},
            behavioral_dimensions: {},
            presentation_strategy: {},
            voice_style: {},
            situational_state: {},
            values: [],
          },
          goals: [],
          memories: {
            episodic: [],
            semantic: [],
            relationship_summaries: [],
          },
          perceived_state_overlays: [],
        },
      ],
      relationships: [],
      events: [],
      scenes: [],
    };

    await cache.putGlobal(documentDefinition, payload);
    const roundTrip = cache.getRequiredGlobal(documentDefinition);
    assert.equal(validateGhostlightAgentStateGenerated(roundTrip), true);
    assert.equal(roundTrip.schema_version, "ghostlight.agent_state.v0");
    assert.equal(roundTrip.agents[0]?.agent_id, "void");
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});
