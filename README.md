# CultNet TS

`cultnet-ts` is the TypeScript port of the useful shape of GameCult's
networking layer: typed MessagePack messages, direct-pipe framing, CultLib-style
security/session helpers, and state replication that hands typed values into a
`CultCache` instead of making consumer code paw raw database envelopes.

This is not an HTTP wrapper wearing a fake mustache. It is for runtimes that
already trust a direct channel and want a compact shared contract over it.

## Scope

The library currently includes:

- JSON-schema-backed wire contracts for the first CultNet message set
- a MessagePack codec plus 4-byte length-prefixed framing for direct pipes
- a `CultNetPeer` wrapper over any Node `Duplex`
- CultLib-style client/server security options and `Secret` helpers
- session-token signing/validation compatible with the C# CultLib semantics
- `CultCacheTS` replication helpers for document put/delete/snapshot flows
- an exact mirrored runtime validator and TS contract surface for Ghostlight's
  canonical `ghostlight.agent_state.v0` payload

## Why This Exists

We want:

- one shared agent-state vocabulary across `Ghostlight`, `EpiphanyAgent`,
  `VoidBot`, and whatever other little laboratory creature appears next
- typed persistence through `CultCache`
- direct pipes instead of every consumer inventing bespoke JSON fog
- authentication and session semantics that match the original CultLib intent

So the split is:

- `cultcache-ts`: typed local persistence
- `cultnet-ts`: typed transport, auth, and state replication

Same family. Different organs. Nobody needs a second spine growing out of the
transport layer.

## Contracts

Wire contracts live under `contracts/` as JSON Schema files.

Current message families:

- `cultnet.hello.v0`
- `cultnet.login.v0`
- `cultnet.register.v0`
- `cultnet.verify.v0`
- `cultnet.login_success.v0`
- `cultnet.error.v0`
- `cultnet.document_put.v0`
- `cultnet.document_delete.v0`
- `cultnet.snapshot_request.v0`
- `cultnet.snapshot_response.v0`

For shared agent state, the first payload contract is the existing Ghostlight
fixture format:

- payload schema version: `ghostlight.agent_state.v0`
- mirrored validator: `contracts/ghostlight.agent-state.schema.json`

That means `EpiphanyAgent` role dossiers and Ghostlight fixtures can travel over
CultNet without inventing a second ontology first.

## Quick Example

```ts
import { Duplex } from "node:stream";
import { z } from "zod";
import { CultCache, defineDocumentType } from "cultcache-ts";
import {
  CultNetDocumentRegistry,
  CultNetPeer,
  CultNetClientSecurityOptions,
  CultNetSecret,
  defineCultNetDocumentBinding,
} from "cultnet-ts";

const ghostlightStateDefinition = defineDocumentType({
  type: "ghostlight.agent-state",
  schema: z.object({
    schema_version: z.literal("ghostlight.agent_state.v0"),
    world: z.record(z.unknown()),
    agents: z.array(z.record(z.unknown())),
    relationships: z.array(z.record(z.unknown())),
    events: z.array(z.record(z.unknown())),
    scenes: z.array(z.record(z.unknown())),
  }),
});

const registry = new CultNetDocumentRegistry([
  defineCultNetDocumentBinding({
    definition: ghostlightStateDefinition,
    payloadSchemaVersion: "ghostlight.agent_state.v0",
  }),
]);
```

## Security Model

The security helpers intentionally mirror CultLib's shape:

- shared connection key -> SHA-256 derived AES-GCM key
- server-only session signing secret -> HMAC-SHA256 session token signing
- 12-byte nonce
- authentication tag prefixed onto ciphertext
- session token format: `base64url(payload).base64url(signature)`

That means a TypeScript runtime can follow the same cryptographic and session
story as the C# version instead of inventing one more house religion around
"trust me, this pipe is probably fine."

## Current Limits

- This repo currently implements the client-side wire contract and pipe
  ergonomics, not a full account server.
- The Ghostlight agent-state mirror is an exact copy of Ghostlight's current
  canonical schema. If Ghostlight changes the contract, this mirror must be
  updated in lockstep instead of playing coy with partial validation.
- The direct transport is any Node `Duplex`; named-pipe/socket server wrappers
  can be added without changing the message contract.

## Development

```bash
npm install
npm run build
npm run typecheck
npm run test
```
