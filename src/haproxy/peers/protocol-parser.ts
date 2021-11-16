/*!
 * Copyright (C) 2020 WoltLab GmbH
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Lesser General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU Lesser General Public License for more details.
 *
 * You should have received a copy of the GNU Lesser General Public License
 * along with this program.  If not, see <https://www.gnu.org/licenses/>.
 *
 * SPDX-License-Identifier: LGPL-3.0-or-later
 */

import * as messages from "./messages";
import * as VarInt from "./varint";
import d from "debug";
import { ControlMessageClass, DataType, MessageClass, TableKeyType, UpdateMessageType } from "./wire-types";
import {
  SignedInt32TableKey,
  StringTableKey,
  TableDefinition,
  TableKey,
  TableValue,
  UnsignedInt32TableValue,
  UnsignedInt64TableValue,
} from "./types";
import { Transform, TransformCallback, TransformOptions } from "stream";

const debug = d("manager:haproxy:peers:protocol-parser");

/**
 * Helper class for safe buffer handling.
 */
class Pointer {
  private position = 0;
  constructor(private size: number) {}

  /**
   * Moves the pointer forward by the given amount.
   * Throws the given error message (or a generic message) if size
   * is exceeded after the consumption.
   */
  consume(amount: number, error?: any): void {
    this.position += amount;
    if (this.position > this.size) {
      throw new Error(error || "Pointer exceeded");
    }
  }

  /**
   * Asserts that the pointer can be moved by the given amount.
   * Throws the given error message (or a generic message) if size
   * would be exceeded when calling `consume(amount)`.
   */
  assert(amount: number, error?: any): void {
    if (this.position + amount > this.size) {
      throw new Error(error || "Pointer exceeded");
    }
  }

  /**
   * Returns whether the current position reached the maximum size.
   */
  isEmpty(): boolean {
    return this.position >= this.size;
  }

  /**
   * Returns a slice of the given buffer starting at the current position of the Pointer.
   * If `end` is given the slice will contain exactly `end` bytes. An error is thrown if
   * the Pointer does not contain `end` bytes.
   */
  sliceBuffer(buffer: Buffer, end?: number, error?: any): Buffer {
    if (end !== undefined) {
      this.assert(end, error);
      return buffer.slice(this.position, this.position + end);
    }
    return buffer.slice(this.position);
  }

  /**
   * Returns the current position of the Pointer.
   */
  get(): number {
    return this.position;
  }
}

// tslint:disable-next-line: max-classes-per-file
export class PeerParser extends Transform {
  private buffer: Buffer;
  private lastTableDefinition?: TableDefinition;
  private lastUpdateId?: number;

  constructor(options: TransformOptions = {}) {
    options.readableObjectMode = true;
    super(options);
    this.buffer = Buffer.alloc(0);
  }

  /**
   * Attempt to parse the contents in the given Buffer. Returns the
   * number of consumed bytes or `null` if no complete message could be parsed.
   *
   * @param buffer
   */
  private tryParse(buffer: Buffer): number | null {
    if (buffer.length < 1) {
      return null;
    }

    const map = new Map<MessageClass, (buffer: Buffer) => number | null>([
      [MessageClass.CONTROL, (buffer) => this.tryParseControlMessage(buffer)],
      [MessageClass.UPDATE, (buffer) => this.tryParseUpdateMessage(buffer)],
    ]);
    const parseMethod = map.get(buffer[0]);
    if (!parseMethod) {
      throw new Error(`Unhandled MessageClass '${buffer[0]}'.`);
    }

    const consumed = parseMethod(buffer.slice(1));
    if (consumed !== null) {
      return 1 + consumed;
    }
    return null;
  }

  private tryParseControlMessage(buffer: Buffer): number | null {
    if (buffer.length < 1) {
      return null;
    }

    const map = new Map<ControlMessageClass, new () => messages.Message>([
      [ControlMessageClass.HEARTBEAT, messages.Heartbeat],
      [ControlMessageClass.SYNCHRONIZATION_REQUEST, messages.SynchronizationRequest],
      [ControlMessageClass.SYNCHRONIZATION_FINISHED, messages.SynchronizationFull],
      [ControlMessageClass.SYNCHRONIZATION_PARTIAL, messages.SynchronizationPartial],
      [ControlMessageClass.SYNCHRONIZATION_CONFIRMED, messages.SynchronizationConfirmed],
    ]);
    const messageClass = map.get(buffer[0]);
    if (!messageClass) {
      throw new Error(`Unhandled ControlMessageClass '${buffer[0]}'`);
    }

    this.push(new messageClass());
    return 1;
  }

  private tryParseUpdateMessage(buffer: Buffer): number | null {
    if (buffer.length < 1) {
      return null;
    }

    switch (buffer[0] as UpdateMessageType) {
      case UpdateMessageType.STICK_TABLE_DEFINITION: {
        const consumed = this.tryParseTableDefinition(buffer.slice(1));
        if (consumed !== null) {
          return 1 + consumed;
        }
        return null;
      }
      case UpdateMessageType.ENTRY_UPDATE:
      case UpdateMessageType.ENTRY_UPDATE_TIMED:
      case UpdateMessageType.INCREMENTAL_ENTRY_UPDATE:
      case UpdateMessageType.INCREMENTAL_ENTRY_UPDATE_TIMED: {
        if (this.lastTableDefinition === undefined) {
          throw new Error("Unable to handle entry updates without a stick table definition");
        }

        const incremental =
          buffer[0] === UpdateMessageType.INCREMENTAL_ENTRY_UPDATE ||
          buffer[0] === UpdateMessageType.INCREMENTAL_ENTRY_UPDATE_TIMED;
        const timed =
          buffer[0] === UpdateMessageType.ENTRY_UPDATE_TIMED ||
          buffer[0] === UpdateMessageType.INCREMENTAL_ENTRY_UPDATE_TIMED;
        const consumed = this.tryParseEntryUpdate(buffer.slice(1), {
          incremental,
          timed,
        });
        if (consumed !== null) {
          return 1 + consumed;
        }
        return null;
      }
      default:
        throw new Error(`Unhandled UpdateMessageType '${buffer[0]}'`);
    }
  }

  /**
   * Attempt to parse a stick table definition.
   *
   * Returns the number of bytes consumed or
   * `null` if no complete definition could be found.
   *
   * @param buffer
   */
  private tryParseTableDefinition(buffer: Buffer): number | null {
    debug("attempting to parse table definition");
    let length: number,
      senderTableId: number,
      nameLength: number,
      name: string,
      keyType: TableKeyType,
      keyLen: number,
      dataType: DataType,
      expiry: number;

    let consumed;
    [consumed, length] = VarInt.decode(buffer);
    const pointer = new Pointer(consumed + length);
    pointer.consume(consumed);
    length += consumed;
    if (buffer.length < length) {
      return null;
    }

    [consumed, senderTableId] = VarInt.decode(pointer.sliceBuffer(buffer));
    pointer.consume(consumed, "Incorrect packet length (senderTableId)");

    [consumed, nameLength] = VarInt.decode(pointer.sliceBuffer(buffer));
    pointer.consume(consumed, "Incorrect packet length (nameLength)");

    name = pointer.sliceBuffer(buffer, nameLength, "Insufficient data (name)").toString("binary");
    pointer.consume(nameLength, "Incorrect packet length (name)");

    [consumed, keyType] = VarInt.decode(pointer.sliceBuffer(buffer));
    pointer.consume(consumed, "Incorrect packet length (keyType)");
    if (!TableKeyType[keyType]) {
      throw new Error(`Incorrect key type '${keyType}'`);
    }

    [consumed, keyLen] = VarInt.decode(pointer.sliceBuffer(buffer));
    pointer.consume(consumed, "Incorrect packet length (keyLen)");
    [consumed, dataType] = VarInt.decode(pointer.sliceBuffer(buffer));
    pointer.consume(consumed, "Incorrect packet length (dataType)");
    [consumed, expiry] = VarInt.decode(pointer.sliceBuffer(buffer));
    pointer.consume(consumed, "Incorrect packet length (expiry)");

    if (!pointer.isEmpty()) {
      throw new Error("Incorrect packet length (total)");
    }

    const dataTypes = [];
    for (const type of Object.values(DataType)) {
      if (typeof type !== "number") {
        continue;
      }
      // tslint:disable-next-line: no-bitwise
      if ((dataType >> type) & 1) {
        dataTypes.push(type);
      }
    }

    const definition = {
      senderTableId,
      name,
      keyType,
      keyLen,
      dataTypes,
      expiry,
    };
    this.lastTableDefinition = definition;
    this.push(new messages.TableDefinition(definition));

    return pointer.get();
  }

  /**
   * Attempt to parse an entry update message.
   * Returns a pair of the number of bytes consume and an object containing the table
   * definition used for parsing and the actual entry update or `null` if no complete
   * message could be found.
   *
   * @param buffer
   * @param isTimed
   */
  private tryParseEntryUpdate(
    buffer: Buffer,
    options: {
      timed: boolean;
      incremental: boolean;
    },
  ): number | null {
    debug("attempting to parse entry update %o", options);
    const tableDefinition = this.lastTableDefinition;
    if (tableDefinition === undefined) {
      throw new Error("Unable to parse entry update without a stick table definition.");
    }
    if (options.incremental && this.lastUpdateId === undefined) {
      throw new Error("Unable to parse incremental entry update without an old update.");
    }

    let length: number,
      updateId: number,
      expiry: number | null = null,
      key: TableKey<unknown>;

    let consumed;
    [consumed, length] = VarInt.decode(buffer);
    const pointer = new Pointer(consumed + length);
    pointer.consume(consumed);
    length += consumed;
    if (buffer.length < length) {
      return null;
    }

    if (options.incremental) {
      updateId = this.lastUpdateId! + 1;
    } else {
      pointer.assert(4, "Insufficient data (updateId)");
      updateId = buffer.readUInt32BE(pointer.get());
      pointer.consume(4, "Incorrect packet length (updateId)");
    }
    if (options.timed) {
      pointer.assert(4, "Insufficient data (expiry)");
      expiry = buffer.readUInt32BE(pointer.get());
      pointer.consume(4, "Incorrect packet length (expiry)");
    }
    switch (tableDefinition.keyType) {
      case TableKeyType.STRING: {
        let keyLen;
        [consumed, keyLen] = VarInt.decode(pointer.sliceBuffer(buffer));
        pointer.consume(consumed, "Incorrect packet length (keyLen)");
        pointer.assert(keyLen, "Insufficient data (key)");
        key = new StringTableKey(pointer.sliceBuffer(buffer, keyLen).toString("binary"));
        pointer.consume(keyLen, "Incorrect packet length (key)");
        break;
      }
      case TableKeyType.SINT:
        pointer.assert(4, "Insufficient data (key)");
        key = new SignedInt32TableKey(buffer.readInt32BE(pointer.get()));
        pointer.consume(4, "Incorrect packet length (key)");
        break;
      default:
        throw new Error(`Unable to handle key type '${tableDefinition.keyType}'.`);
    }

    const values: Map<DataType, TableValue<unknown>> = new Map();
    for (const dataType of tableDefinition.dataTypes) {
      switch (DataType.getDecodedType(dataType)) {
        case DataType.DecodedType.UINT: {
          let number;
          [consumed, number] = VarInt.decode(pointer.sliceBuffer(buffer));
          values.set(dataType, new UnsignedInt32TableValue(number));
          pointer.consume(consumed, `Incorrect packet length (value for '${dataType}')`);
          break;
        }
        case DataType.DecodedType.ULONGLONG: {
          let number;
          [consumed, number] = VarInt.decode(pointer.sliceBuffer(buffer));
          values.set(dataType, new UnsignedInt64TableValue(number));
          pointer.consume(consumed, `Incorrect packet length (value for '${dataType}')`);
          break;
        }
        default:
          throw new Error(`Unable to handle decoded data type '${DataType.getDecodedType(dataType)}'.`);
      }
    }

    if (!pointer.isEmpty()) {
      throw new Error("Incorrect packet length (total)");
    }

    const update = {
      updateId,
      expiry,
      key,
      values,
    };
    this.lastUpdateId = update.updateId;
    this.push(new messages.EntryUpdate(tableDefinition, update));

    return pointer.get();
  }

  _transform(chunk: Buffer, _encoding: string, callback: TransformCallback): void {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    try {
      let pointer = 0;
      for (;;) {
        const consumed = this.tryParse(this.buffer.slice(pointer));
        if (consumed === null) {
          break;
        }
        pointer += consumed;
      }
      this.buffer = Buffer.from(this.buffer.slice(pointer));
      callback();
    } catch (e) {
      callback(e);
    }
  }
}

export default PeerParser;
