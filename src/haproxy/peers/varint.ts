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

// tslint:disable: no-bitwise

/**
 * Decodes the given buffer as a varint.
 * Returns a pair containing the number of consumed bytes and the parsed int.
 *
 * @param buffer
 */
export function decode(buffer: Buffer): [number, number] {
  if (buffer.length < 1) {
    throw new Error("Insufficient data");
  }
  let val = buffer[0];
  buffer = buffer.slice(1);
  if ((val & 0b11110000) !== 0b11110000) {
    return [1, val];
  }
  for (const pair of buffer.entries()) {
    val += pair[1] << (4 + 7 * pair[0]);
    if ((pair[1] & 0b10000000) === 0) {
      return [2 + pair[0], val];
    }
  }
  throw new Error("Insufficient data");
}

/**
 * Returns a Buffer containing the given `int` encoded as a HAProxy varint.
 * @param int
 */
export function encode(int: number): Buffer {
  if (int < 0xf0) {
    return Buffer.from([int]);
  }
  const result = [];
  result.push((int & 0xff) | 0xf0);
  int -= 0xf0;
  int = int >> 4;
  while (int >= 0x80) {
    result.push((int & 0b01111111) | 0x80);
    int -= 0x80;
    int = int >> 7;
  }
  result.push(int);
  return Buffer.from(result);
}
