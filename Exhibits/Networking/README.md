# Networking

Evidence for the networking scaffold: `Frontier/Extensions/Networking/` (`NetworkingSpace`, `NetworkingExtension`).

## What it is

| Part                  | Role                                                                                     |
|-----------------------|------------------------------------------------------------------------------------------|
| `NetworkingSpace`     | The abstract world of one session: peers, roles (host, client), messages, tallies        |
| `NetworkTransport`    | The interface every transport implements (send, receive, name)                           |
| `LoopbackTransport`   | Both ends in one process, framed and unframed as a socket would carry them               |
| `NetworkingExtension` | Host: replicates changed `WorldSpace` records as their level TOML; client: absorbs them  |

A message travels as a 24-byte little-endian header (sender, receiver, topic, sequence, payload length) plus a TOML
payload. A host record is matched to the client's record of the same type and name, or constructed on the client.

## Later

- `EOSExtension` or `EpicAdapter`: Epic Online Services behind `NetworkTransport`, starting from the inherited sources in
  `Frontier/Projects/Project-Networking/Source` (`EosTransport`, `EpicExchange`, `EcomOwnership`, `LobbyRuntime`).
- Interest management and rates per record, and authority beyond host and client.

## Test

`NetworkingSpaceValidation` (ctest) joins a host level and a client level through the loopback transport:

- The first replication sends 3 records, and the client's level then matches the host's.
- An unchanged level sends nothing; moving the sun sends one message.
- Removing a record removes it on the client.
- Damaged frames are refused, and the tallies on both sides agree.

The ledger is in `Results/NetworkingSpaceValidation.md`.
