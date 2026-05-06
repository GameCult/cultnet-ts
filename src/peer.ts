import { EventEmitter } from "node:events";
import type { Duplex } from "node:stream";

import { decode, encode } from "@msgpack/msgpack";

import { parseCultNetMessage, type CultNetDocumentDeleteMessage, type CultNetDocumentPutMessage, type CultNetErrorMessage, type CultNetHelloMessage, type CultNetLoginMessage, type CultNetLoginSuccessMessage, type CultNetMessage, type CultNetRegisterMessage, type CultNetSnapshotRequestMessage, type CultNetSnapshotResponseMessage, type CultNetVerifyMessage } from "./contracts";
import { encodeFrame, LengthPrefixedMessageFramer } from "./framing";

export interface CultNetPeerEvents {
  message: (message: CultNetMessage) => void;
  invalidMessage: (error: Error) => void;
  close: () => void;
  error: (error: Error) => void;
}

export class CultNetPeer extends EventEmitter {
  readonly #stream: Duplex;
  readonly #framer = new LengthPrefixedMessageFramer();

  constructor(stream: Duplex) {
    super();
    this.#stream = stream;
    this.#stream.on("data", (chunk: Buffer) => {
      for (const frame of this.#framer.push(chunk)) {
        try {
          const decoded = decode(frame);
          const message = parseCultNetMessage(decoded);
          this.emit("message", message);
        } catch (error) {
          this.emit("invalidMessage", error instanceof Error ? error : new Error(String(error)));
        }
      }
    });
    this.#stream.on("close", () => this.emit("close"));
    this.#stream.on("error", (error) => this.emit("error", error instanceof Error ? error : new Error(String(error))));
  }

  send(message: CultNetMessage): void {
    this.#stream.write(encodeFrame(encode(message)));
  }

  sendHello(message: CultNetHelloMessage): void {
    this.send(message);
  }

  sendLogin(message: CultNetLoginMessage): void {
    this.send(message);
  }

  sendRegister(message: CultNetRegisterMessage): void {
    this.send(message);
  }

  sendVerify(message: CultNetVerifyMessage): void {
    this.send(message);
  }

  sendLoginSuccess(message: CultNetLoginSuccessMessage): void {
    this.send(message);
  }

  sendError(message: CultNetErrorMessage): void {
    this.send(message);
  }

  sendDocumentPut(message: CultNetDocumentPutMessage): void {
    this.send(message);
  }

  sendDocumentDelete(message: CultNetDocumentDeleteMessage): void {
    this.send(message);
  }

  sendSnapshotRequest(message: CultNetSnapshotRequestMessage): void {
    this.send(message);
  }

  sendSnapshotResponse(message: CultNetSnapshotResponseMessage): void {
    this.send(message);
  }

  close(): void {
    this.#stream.end();
  }
}
