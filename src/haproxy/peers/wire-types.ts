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

export enum MessageClass {
  CONTROL = 0,
  ERROR = 1,
  UPDATE = 10,
  RESERVED = 255,
}

export enum ControlMessageClass {
  SYNCHRONIZATION_REQUEST = 0,
  SYNCHRONIZATION_FINISHED = 1,
  SYNCHRONIZATION_PARTIAL = 2,
  SYNCHRONIZATION_CONFIRMED = 3,
  HEARTBEAT = 4,
}

export enum UpdateMessageType {
  ENTRY_UPDATE = 128,
  INCREMENTAL_ENTRY_UPDATE = 129,
  STICK_TABLE_DEFINITION = 130,
  STICK_TABLE_SWITCH = 131,
  ACK = 132,
  ENTRY_UPDATE_TIMED = 133,
  INCREMENTAL_ENTRY_UPDATE_TIMED = 134,
}

export enum DataType {
  SERVER_ID = 0,
  GPT0 = 1,
  GPC0 = 2,
  GPC0_RATE = 3,
  CONN_CNT = 4,
  CONN_RATE = 5,
  CONN_CUR = 6,
  SESS_CNT = 7,
  SESS_RATE = 8,
  HTTP_REQ_CNT = 9,
  HTTP_REQ_RATE = 10,
  HTTP_ERR_CNT = 11,
  HTTP_ERR_RATE = 12,
  BYTES_IN_CNT = 13,
  BYTES_IN_RATE = 14,
  BYTES_OUT_CNT = 15,
  BYTES_OUT_RATE = 16,
  GPC1 = 17,
  GPC1_RATE = 18,
}

export namespace DataType {
  export enum DecodedType {
    SINT,
    UINT,
    ULONGLONG,
  }

  export function getDecodedType(dataType: DataType): DecodedType {
    switch (dataType) {
      case DataType.SERVER_ID:
        return DecodedType.SINT;
      case DataType.GPT0:
      case DataType.GPC0:
      case DataType.CONN_CNT:
      case DataType.CONN_CUR:
      case DataType.SESS_CNT:
      case DataType.HTTP_REQ_CNT:
      case DataType.HTTP_ERR_CNT:
      case DataType.GPC1:
        return DecodedType.UINT;
      case DataType.BYTES_IN_CNT:
      case DataType.BYTES_OUT_CNT:
        return DecodedType.ULONGLONG;
      default:
        throw new Error(`Unhandled DataType ${dataType}`);
    }
  }
}

export enum TableKeyType {
  SINT = 2,
  IPv4 = 4,
  IPv6 = 5,
  STRING = 6,
  BINARY = 7,
}
