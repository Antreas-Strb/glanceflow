# Third-party notices

Parts of `glanceflow/hooks/privacy.ts` are adapted from Recording Mode in [nateherkai/claude-code-mods](https://github.com/nateherkai/claude-code-mods), used under the MIT licence below.

```
MIT License

Copyright (c) 2026 Nate Herk

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

`.github/types/` holds the plugin API declarations Claude Code 2.1.318 writes beside a mod (`.claude-plugin/types/`), copied so CI can type-check GlanceFlow. One doc comment in `claude-code-tools/index.d.ts` differs: in `ReadNotifications`, the colon after "Server-attested source token" is a dash, because the Plugin Security Scan took the colon form for a hardcoded token. They are © Anthropic PBC, all rights reserved, used subject to the [Claude Code legal agreements](https://code.claude.com/docs/en/legal-and-compliance), and are not covered by this repository's MIT licence. To refresh them after a Claude Code update, copy `claude-code/index.d.ts` and `claude-code-tools/index.d.ts` from a loaded GlanceFlow's `.claude-plugin/types/` and reapply that one edit.
