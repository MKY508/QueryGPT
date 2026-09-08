"""Generate the frontend's investigation state contract without starting the API."""

import argparse
import json
import runpy
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "apps/api/app/models/analysis_state.py"
TARGET = ROOT / "apps/web/src/lib/types/analysis-state.ts"


def render() -> str:
    contract = runpy.run_path(str(SOURCE))
    states = [state.value for state in contract["AnalysisState"]]
    terminal = [state for state in states if state in contract["TERMINAL_ANALYSIS_STATES"]]
    return (
        "// Generated from app/models/analysis_state.py. Run scripts/generate-analysis-state.py.\n"
        f"export const ANALYSIS_STATES = {json.dumps(states)} as const;\n"
        "export type AnalysisState = (typeof ANALYSIS_STATES)[number];\n\n"
        f"export const TERMINAL_ANALYSIS_STATES: readonly AnalysisState[] = {json.dumps(terminal)};\n"
    )


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--check", action="store_true", help="Fail if the generated contract differs"
    )
    args = parser.parse_args()
    content = render()
    if args.check:
        if not TARGET.exists() or TARGET.read_text(encoding="utf-8") != content:
            raise SystemExit("The generated analysis state contract is stale.")
        print("Analysis state contract is current.")
    else:
        TARGET.write_text(content, encoding="utf-8")
        print(f"Generated {TARGET.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
