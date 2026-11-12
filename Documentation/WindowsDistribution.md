# Windows Distribution Trust

## Artifact Channels

| Channel | When it exists | Intended use | Public distribution |
| :--- | :--- | :--- | :---: |
| `Frontier-UV-Windows-x64` | Both executable signatures validate on the Windows runner | Candidate Windows distribution | Yes |
| `Frontier-UV-Windows-x64-unsigned-internal` | No certificate secret is configured | CI and developer testing | No |

The workflow always creates a SHA-256 manifest. A signed channel also receives a GitHub build-provenance attestation. Provenance confirms where the archive was built; it is not an Authenticode signature and does not replace one.

## Required GitHub Configuration

Add these repository **Actions secrets** before distributing a Windows archive publicly:

| Name | Content |
| :--- | :--- |
| `WINDOWS_SIGNING_CERTIFICATE_BASE64` | Base64-encoded password-protected PFX from a publicly trusted code-signing certificate authority. EV signing is recommended for faster Windows reputation establishment. |
| `WINDOWS_SIGNING_CERTIFICATE_PASSWORD` | The PFX password. |

Optionally add this repository **Actions variable**:

| Name | Default | Content |
| :--- | :--- | :--- |
| `WINDOWS_SIGNING_TIMESTAMP_URL` | `http://timestamp.digicert.com` | RFC 3161 timestamp endpoint accepted by the certificate provider. |

The runner writes the PFX only into its temporary directory, signs `FrontierUV.exe` and `FrontierEditor.exe` with SHA-256 and a timestamp, validates both signatures with `Get-AuthenticodeSignature`, then removes the temporary certificate. If a certificate value is supplied but the password, signing tool, timestamp, or signature verification fails, the job fails rather than publishing an unsigned package as signed.

## Consumer Verification

1. Download only the `Frontier-UV-Windows-x64` artifact, not the `-unsigned-internal` artifact.
2. Compare the archive digest with `SHA256SUMS.txt`:

```powershell
(Get-FileHash .\Frontier-UV-Windows-x64.zip -Algorithm SHA256).Hash
```

3. Extract the archive and inspect both executable signatures:

```powershell
Get-AuthenticodeSignature .\FrontierUV.exe
Get-AuthenticodeSignature .\FrontierEditor.exe
```

Both commands must report `Status : Valid` and show the expected publisher certificate.

4. Verify the GitHub artifact attestation against this repository when GitHub CLI is available:

```powershell
# Run from the downloaded archive directory.
gh attestation verify .\Frontier-UV-Windows-x64.zip --repo egoistm1inbox/Frontier
```

## Browser Warning Limitation

No GitHub Actions setting, preview, artifact label, or provenance attestation can guarantee that Chrome will never show a potentially-unsafe-download warning. Chrome Safe Browsing assesses download and publisher reputation independently. Authenticode is the necessary executable trust signal for Windows, and GitHub attestation provides build provenance; neither can bypass a browser warning.

Distribute only a signed archive from a stable GitHub Release or another established download location, preserve its checksum and attestation, and build reputation over time. Do not advise recipients to override a browser or SmartScreen warning for an internal unsigned artifact.
