# NetworkingSpaceValidation

Host and client levels joined by the loopback transport.

| Result | Claim |
|---|---|
| 🟢 | the host's first replication sends its 3 records (3) |
| 🟢 | the client applies the greeting and the 3 records (4) |
| 🟢 | each side knows both peers after the greetings |
| 🟢 | the client level holds 3 records (3) |
| 🟢 | every host record is matched to a client record |
| 🟢 | Solar 'Sun' arrives with the same configuration |
| 🟢 | RigidBody 'Crate' arrives with the same configuration |
| 🟢 | Clouds 'Cumulus' arrives with the same configuration |
| 🟢 | an unchanged level sends nothing |
| 🟢 | moving the sun sends one message (1) |
| 🟢 | the client's sun follows (elevation 12.5°) |
| 🟢 | removing the clouds removes them on the client |
| 🟢 | the client level holds 2 records |
| 🟢 | a packet decodes to the message it encodes (33 bytes) |
| 🟢 | a truncated packet is refused |
| 🟢 | a packet shorter than its header is refused |
| 🟢 | the client received every message and byte the host sent (6 messages, 2676 B) |

17 / 17 assertions.
