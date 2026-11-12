#============================================================================================================================================
#                                                     VERIFYVOCABULARY.PY
#============================================================================================================================================
# 🧩 Compare UV workspace source vocabulary with the approved inventory and produce a compact remediation audit.

from collections import Counter, defaultdict
from pathlib import Path

import argparse
import hashlib
import json
import re
import sys


RepositoryRoot = Path(__file__).resolve().parents[1]
PolicyPath = RepositoryRoot / 'Documentation/BannedWordsVocabulary.md'
AcceptedOccurrencePath = RepositoryRoot / 'Automation/UVVocabularyAllowlist.json'
LexemePattern = re.compile(r'[A-Z]+(?=[A-Z][a-z]|\d|$)|[A-Z]?[a-z]+|\d+')
SourceTokenPattern = re.compile(r'[A-Za-z][A-Za-z0-9_]*')
PermittedLifecycleNames = {
    'AnnotationExtension',
    'AudioExtension',
    'InputExtension',
    'NetworkingExtension',
    'PhysicsExtension',
    'RenderExtension',
    'RevisionExtension',
    'WorkspaceExtension',
}
IgnoredPrefixLexemes = {'is', 'has', 'was', 'can', 'should', 'on'}


#------------------------------------------------------------------------------------------------------------------------
#                                                    POLICY INTERPRETATION
#------------------------------------------------------------------------------------------------------------------------


def ExtractLexemes(Phrase: str) -> list[str]:
    return [Lexeme.lower() for Lexeme in LexemePattern.findall(Phrase)]


def ExtractForbiddenLexemes() -> set[str]:
    PolicyText = PolicyPath.read_text(encoding='utf-8')
    ForbiddenLexemes: set[str] = set()

    PrimarySection = PolicyText.split('### 1.1 Primary Blacklist', maxsplit=1)[1].split('### 1.2', maxsplit=1)[0]
    for Row in PrimarySection.splitlines():
        if not Row.startswith('- '):
            continue
        RulePhrase = Row.split(' *(', maxsplit=1)[0]
        for CapturedPhrase in re.findall(r'`([A-Za-z]+)`', RulePhrase):
            ForbiddenLexemes.update(ExtractLexemes(CapturedPhrase))

    ThematicSection = PolicyText.split('### 1.2 Thematic', maxsplit=1)[1].split('\n---', maxsplit=1)[0]
    for Row in ThematicSection.splitlines():
        Columns = Row.split('|')
        if (len(Columns) < 4 or not Row.lstrip().startswith('| **') or
                'Boolean & bitmask prefixes' in Row):
            continue
        for CapturedPhrase in re.findall(r'`([^`]+)`', Columns[2]):
            ForbiddenLexemes.update(ExtractLexemes(CapturedPhrase.replace('\\*', '')))

    HistoricalLexemePhrases = (
        'backend', 'designation', 'emit', 'emission', 'entity', 'glide', 'harness', 'hierarchy',
        'kind', 'popover', 'proof', 'role', 'shell', 'subsystem', 'system', 'trial', 'trials', 'tween',
    )
    for HistoricalPhrase in HistoricalLexemePhrases:
        ForbiddenLexemes.update(ExtractLexemes(HistoricalPhrase))

    ForbiddenLexemes.difference_update(IgnoredPrefixLexemes)
    ForbiddenLexemes.discard('extension')
    return ForbiddenLexemes


#------------------------------------------------------------------------------------------------------------------------
#                                                     SCOPE ENUMERATION
#------------------------------------------------------------------------------------------------------------------------


def EnumerateScopeFiles() -> list[Path]:
    ScopeFiles: set[Path] = set()
    ScopeRoots = (
        RepositoryRoot / 'Engine/Workspaces/UV',
        RepositoryRoot / 'Engine/GeometricRaster/UV',
    )
    for ScopeRoot in ScopeRoots:
        ScopeFiles.update(Candidate for Candidate in ScopeRoot.rglob('*') if Candidate.suffix in {'.cpp', '.h'})

    ShaderRoot = RepositoryRoot / 'Engine/GeometricRaster/Shaders'
    ScopeFiles.update(ShaderRoot.glob('*.slang'))
    ScopeFiles.update((RepositoryRoot / 'Exhibits').glob('UV*.cpp'))
    ScopeFiles.update(
        {
            RepositoryRoot / 'CMakeLists.txt',
            RepositoryRoot / 'Engine/Lifecycle/DesktopWorkspaceLaunch.cpp',
            RepositoryRoot / 'Engine/Lifecycle/DesktopWorkspaceLaunch.h',
            RepositoryRoot / 'Engine/Lifecycle/FrontierEditorLaunch.cpp',
            RepositoryRoot / 'Engine/Lifecycle/FrontierUVLaunch.cpp',
        }
    )
    return sorted(Candidate for Candidate in ScopeFiles if Candidate.is_file())


#------------------------------------------------------------------------------------------------------------------------
#                                                    OCCURRENCE CAPTURE
#------------------------------------------------------------------------------------------------------------------------


def ExtractTokenLexemes(SourceToken: str) -> list[str]:
    return [Lexeme.lower() for Lexeme in LexemePattern.findall(SourceToken)]


def PermitsRestrictedLifecycleName(SourceToken: str) -> bool:
    return SourceToken in PermittedLifecycleNames


def ConstructFingerprint(RelativePath: str, LineText: str, ForbiddenLexeme: str) -> str:
    DigestInput = f'{RelativePath}\n{LineText}\n{ForbiddenLexeme}'.encode('utf-8')
    return hashlib.sha256(DigestInput).hexdigest()


def ConstructOccurrence(
    RelativePath: str,
    LineNumber: int,
    LineText: str,
    ForbiddenLexeme: str,
) -> dict[str, object]:
    return {
        'fingerprint': ConstructFingerprint(RelativePath, LineText, ForbiddenLexeme),
        'lineNumber': LineNumber,
        'path': RelativePath,
        'term': ForbiddenLexeme,
    }


def EnumerateLineOccurrences(
    RelativePath: str,
    LineNumber: int,
    LineText: str,
    ForbiddenLexemes: set[str],
) -> list[dict[str, object]]:
    Occurrences: list[dict[str, object]] = []
    for SourceToken in SourceTokenPattern.findall(LineText):
        if PermitsRestrictedLifecycleName(SourceToken):
            continue
        TokenLexemes = ExtractTokenLexemes(SourceToken)
        if TokenLexemes[:2] in (['record', 'entry'], ['record', 'token']):
            TokenLexemes = TokenLexemes[2:]
        for ForbiddenLexeme in sorted(set(TokenLexemes) & ForbiddenLexemes):
            Occurrences.append(ConstructOccurrence(RelativePath, LineNumber, LineText, ForbiddenLexeme))
    return Occurrences


def EnumerateOccurrences(ForbiddenLexemes: set[str]) -> list[dict[str, object]]:
    Occurrences: list[dict[str, object]] = []
    for SourcePath in EnumerateScopeFiles():
        RelativePath = SourcePath.relative_to(RepositoryRoot).as_posix()
        Occurrences.extend(EnumerateLineOccurrences(RelativePath, 0, RelativePath, ForbiddenLexemes))
        for LineNumber, LineText in enumerate(SourcePath.read_text(encoding='utf-8', errors='replace').splitlines(), start=1):
            Occurrences.extend(EnumerateLineOccurrences(RelativePath, LineNumber, LineText, ForbiddenLexemes))
    return Occurrences


#------------------------------------------------------------------------------------------------------------------------
#                                                    INVENTORY VERIFICATION
#------------------------------------------------------------------------------------------------------------------------


def ConstructOccurrenceCounter(Occurrences: list[dict[str, object]]) -> Counter[str]:
    return Counter(str(Occurrence['fingerprint']) for Occurrence in Occurrences)


def ReadAcceptedOccurrences() -> Counter[str]:
    Inventory = json.loads(AcceptedOccurrencePath.read_text(encoding='utf-8'))
    return Counter(
        {
            str(Occurrence['fingerprint']): int(Occurrence['count'])
            for Occurrence in Inventory['acceptedOccurrences']
        }
    )


def WriteAcceptedOccurrences(Occurrences: list[dict[str, object]]) -> None:
    OccurrenceCounter = ConstructOccurrenceCounter(Occurrences)
    Inventory = {
        'formatVersion': 1,
        'scope': 'UV workspace native sources, shaders, desktop launchers, CMake, and UV validations',
        'acceptedOccurrences': [
            {'fingerprint': Fingerprint, 'count': Count}
            for Fingerprint, Count in sorted(OccurrenceCounter.items())
        ],
    }
    AcceptedOccurrencePath.write_text(json.dumps(Inventory, indent=2) + '\n', encoding='utf-8')


def WriteAudit(ReportPath: Path, Occurrences: list[dict[str, object]], ScopeFileCount: int) -> None:
    CountsByTerm = Counter(str(Occurrence['term']) for Occurrence in Occurrences)
    LocationsByTerm: dict[str, list[str]] = defaultdict(list)
    for Occurrence in Occurrences:
        Location = f"{Occurrence['path']}:{Occurrence['lineNumber']}"
        if Location not in LocationsByTerm[str(Occurrence['term'])]:
            LocationsByTerm[str(Occurrence['term'])].append(Location)

    Lines = [
        '# UV Workspace Vocabulary Audit',
        '',
        '## Scope',
        '',
        f'- Native source files inspected: `{ScopeFileCount}`',
        f'- Current lexical occurrences: `{len(Occurrences)}`',
        f'- Distinct policy roots: `{len(CountsByTerm)}`',
        '- Restricted lifecycle coordinators and approved `RecordEntry` / `RecordToken` compounds are excluded.',
        '',
        '## Counts',
        '',
        '| Policy root | Occurrences | First locations |',
        '| :--- | ---: | :--- |',
    ]
    for ForbiddenLexeme, Count in CountsByTerm.most_common():
        Locations = '<br>'.join(LocationsByTerm[ForbiddenLexeme][:3])
        Lines.append(f'| `{ForbiddenLexeme}` | {Count} | `{Locations}` |')
    Lines.extend(
        [
            '',
            '## Enforcement',
            '',
            'The checked-in occurrence inventory is a transition ledger, not a vocabulary exemption. '
            'Verification fails when a newly introduced lexical occurrence is not in that ledger. '
            'Removing a listed occurrence is always allowed; do not regenerate the ledger to bypass a new finding.',
            '',
        ]
    )
    ReportPath.parent.mkdir(parents=True, exist_ok=True)
    ReportPath.write_text('\n'.join(Lines), encoding='utf-8')


#------------------------------------------------------------------------------------------------------------------------
#                                                        ENTRY POINT
#------------------------------------------------------------------------------------------------------------------------


def Main() -> int:
    CommandLine = argparse.ArgumentParser(description='Audit UV workspace source vocabulary against the policy inventory.')
    CommandLine.add_argument('--verify', action='store_true', help='Fail when a new prohibited lexical occurrence appears.')
    CommandLine.add_argument('--write-accepted-occurrences', action='store_true', help='Refresh the transition ledger from current sources.')
    CommandLine.add_argument('--report', type=Path, help='Write a Markdown audit to this path.')
    Arguments = CommandLine.parse_args()

    ForbiddenLexemes = ExtractForbiddenLexemes()
    Occurrences = EnumerateOccurrences(ForbiddenLexemes)
    ScopeFileCount = len(EnumerateScopeFiles())

    if Arguments.write_accepted_occurrences:
        WriteAcceptedOccurrences(Occurrences)
        print(f'[Vocabulary] recorded {len(Occurrences)} accepted occurrences across {ScopeFileCount} source files.')

    if Arguments.report is not None:
        WriteAudit(Arguments.report, Occurrences, ScopeFileCount)
        print(f'[Vocabulary] audit written to {Arguments.report}.')

    if not Arguments.verify:
        return 0
    if not AcceptedOccurrencePath.exists():
        print('[Vocabulary] transition ledger is missing: ' + str(AcceptedOccurrencePath), file=sys.stderr)
        return 1

    AcceptedOccurrences = ReadAcceptedOccurrences()
    CurrentOccurrences = ConstructOccurrenceCounter(Occurrences)
    UnexpectedOccurrences = CurrentOccurrences - AcceptedOccurrences
    if not UnexpectedOccurrences:
        print(f'[Vocabulary] no new occurrences across {ScopeFileCount} source files.')
        return 0

    OccurrencesByFingerprint = defaultdict(list)
    for Occurrence in Occurrences:
        OccurrencesByFingerprint[str(Occurrence['fingerprint'])].append(Occurrence)
    print('[Vocabulary] newly introduced occurrences:', file=sys.stderr)
    for Fingerprint, Count in UnexpectedOccurrences.items():
        for Occurrence in OccurrencesByFingerprint[Fingerprint][:Count]:
            print(
                f"  {Occurrence['path']}:{Occurrence['lineNumber']}: {Occurrence['term']}",
                file=sys.stderr,
            )
    return 1


if __name__ == '__main__':
    sys.exit(Main())
