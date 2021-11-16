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

import net from "net";
import {
  PeerConnection,
  PeerDirection,
  TableDefinition,
  EntryUpdate,
  SynchronizationType,
} from "./haproxy/peers";
import { DataType } from "./haproxy/peers/wire-types";

function reconnect() {
  console.log("connecting");
  const socket = net.connect(20000, "127.0.0.1");
  const conn = new PeerConnection(socket, {
    myName: "tracker",
    peerName: "haproxy.example.com",
    direction: PeerDirection.OUT,
  });
  socket.on("close", () => setTimeout(reconnect, 1500));
  socket.on("error", (e) => {
    console.log(e);
  });

  conn.on("tableDefinition", (def: TableDefinition) => {
    console.log(`Received table defition ${def.name}:`, def);
  });
  conn.on("entryUpdate", (update: EntryUpdate, def: TableDefinition) => {
    console.log(
      `Received entry update in table ${def.name} for key '${update.key.key}':`,
      new Map(Array.from(update.values.entries()).map(([k, v]) => {
        return [DataType[k], v];
      }))
    );
  });
  conn.on("synchronizationStarted", () => {
    console.log(`Started sync`);
  });
  conn.on("synchronizationFinished", (type: SynchronizationType) => {
    console.log(`Finished sync ${type}`);
  });
  conn.start(true);
}
reconnect();
