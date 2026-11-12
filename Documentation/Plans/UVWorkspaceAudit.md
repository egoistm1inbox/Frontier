# UV Workspace Audit — 2026-11-12

## Outcome

| Check | Result | Evidence |
| :--- | :--- | :--- |
| Native workspace intake | Complete | Imported the C++20 UV workspace, Slang units, launchers, UV validations, automation, and the controlled-integrator sample from `arena/4c9015d5-frontier`. |
| Windows build definition | Corrected | Removed the unused `FRONTIER_SLANG_WASM` input and nonexistent `slang-loader` path. CMake now invokes the pinned native Slang compiler and stops immediately if recovery does not produce it. |
| Vocabulary inventory | Transitional | `Automation/VerifyVocabulary.py` scans 51 UV-native files. The initial inventory contains 415 known occurrences across 38 policy roots. New occurrences fail both Actions workflows. |
| Portable package | Prepared | The Windows workflow builds `FrontierUV`, `FrontierEditor`, and `UVBoundaryValidation`; runs the boundary check; includes compiled shaders and engine content; and writes a SHA-256 manifest. |
| Public download trust | Configuration required | A publicly trusted Authenticode certificate must be added as Actions secrets before a package is labelled signed. Untouched repositories only receive an explicitly internal unsigned package. |

## Vocabulary Findings

The branch is **not** vocabulary-clean today. The highest-count lexical roots are `info` (51), `record` (50), `data` (43), `binding` (38), `context` (27), and `pipeline` (23). Several findings arise in Vulkan and Slang API spellings that require a deliberate approved-interface ruling before any rename.

`Automation/UVVocabularyAllowlist.json` is an occurrence-level transition ledger, not a waiver. `VerifyVocabulary.py --verify` compares the current scanner output to that ledger: deleting a listed occurrence is accepted, but adding a new occurrence fails. The full per-run audit is emitted as `Build/UVVocabularyAudit.md` and uploaded by both CI workflows.

## Remediation Order

1. Resolve local names, comments, source names, and CMake wording that do not expose an external API.
2. Document a narrow ruling for vendor API spellings required by Vulkan, ImGui, GLFW, CMake, or Slang before retaining them.
3. Replace ledger entries as each source unit reaches zero non-exempt findings; do not regenerate the ledger as a shortcut.
4. When all entries are removed, delete `UVVocabularyAllowlist.json` and make the scanner a zero-occurrence gate.

## Windows Distribution Boundary

GitHub provenance attestation and Authenticode solve different problems. The workflow emits an attestation only for an Authenticode-signed archive, and publishes an unsigned archive only under an unmistakably internal artifact name. This prevents an unsigned build from being mistaken for a public installer.

GitHub cannot grant Chrome or Windows reputation solely through a workflow setting. See [WindowsDistribution.md](../WindowsDistribution.md) for the required certificate configuration and the verification steps for each package.
