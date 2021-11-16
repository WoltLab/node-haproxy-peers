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

import d from "debug";
import { EventEmitter } from "events";
import { Readable } from "stream";

const debug = d("manager:stream");

async function eventPromise(emitter: EventEmitter, event: string): Promise<unknown[]> {
  return new Promise(function (resolve: (args: unknown[]) => void, reject: (err: any) => void): void {
    emitter.once("error", reject);
    emitter.once(event, (...args) => resolve(args));
  });
}

export async function blockingRead(stream: Readable, encoding?: null): Promise<Buffer | null>;
export async function blockingRead(stream: Readable, encoding: string): Promise<string | null>;
export async function blockingRead(stream: Readable, encoding: string | null = null): Promise<Buffer | string | null> {
  let chunk = stream.read();
  if (!chunk) {
    debug("read blocks");
    await eventPromise(stream, "readable");
    chunk = stream.read();
  }

  if (chunk === null) {
    return null;
  }

  if (encoding !== null) {
    return chunk.toString(encoding);
  }

  return chunk;
}
