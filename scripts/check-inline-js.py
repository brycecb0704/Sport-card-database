#!/usr/bin/env python3
"""Extract inline JavaScript from HTML and syntax-check it with Node.js.

This deliberately checks syntax only; it does not claim to test browser behavior,
Supabase access, external APIs, or the live deployed application.
"""
from html.parser import HTMLParser
from pathlib import Path
import subprocess
import sys
import tempfile

JS_TYPES = {
    "",
    "text/javascript",
    "application/javascript",
    "text/ecmascript",
    "application/ecmascript",
    "module",
}


class InlineScriptParser(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=False)
        self.in_script = False
        self.should_check = False
        self.script_type = ""
        self.parts = []
        self.scripts = []

    def handle_starttag(self, tag, attrs):
        if tag.lower() != "script":
            return
        attrs = dict(attrs)
        self.in_script = True
        self.script_type = (attrs.get("type") or "").strip().lower()
        self.should_check = not attrs.get("src") and self.script_type in JS_TYPES
        self.parts = []

    def handle_data(self, data):
        if self.in_script and self.should_check:
            self.parts.append(data)

    def handle_endtag(self, tag):
        if tag.lower() != "script" or not self.in_script:
            return
        if self.should_check:
            source = "".join(self.parts)
            if source.strip():
                self.scripts.append((self.script_type or "classic", source))
        self.in_script = False
        self.should_check = False
        self.parts = []


def main():
    if len(sys.argv) != 2:
        print("Usage: python scripts/check-inline-js.py index.html", file=sys.stderr)
        return 2

    html_path = Path(sys.argv[1])
    parser = InlineScriptParser()
    parser.feed(html_path.read_text(encoding="utf-8"))
    if not parser.scripts:
        print("No inline JavaScript blocks found.")
        return 1

    failed = False
    for index, (script_type, source) in enumerate(parser.scripts, start=1):
        with tempfile.NamedTemporaryFile(
            mode="w", encoding="utf-8", suffix=".mjs", delete=False
        ) as temp:
            temp.write(source)
            temp_path = Path(temp.name)
        try:
            result = subprocess.run(
                ["node", "--check", str(temp_path)],
                text=True,
                capture_output=True,
                check=False,
            )
            if result.returncode:
                failed = True
                print(f"FAIL: inline script #{index} ({script_type})")
                print(result.stdout, end="")
                print(result.stderr, end="")
            else:
                print(f"PASS: inline script #{index} ({script_type})")
        finally:
            temp_path.unlink(missing_ok=True)

    if failed:
        print("Inline JavaScript syntax validation failed.")
        return 1
    print(f"All {len(parser.scripts)} inline JavaScript block(s) passed syntax checks.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
