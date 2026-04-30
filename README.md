# HumanType

A Chrome extension that types your text letter-by-letter, mimicking real human typing patterns — complete with variable speed, natural pauses, and optional typos.

## Features

- **Adjustable speed** — 28 WPM to 300 WPM via a slider
- **Realistic timing** — longer pauses after punctuation, mid-sentence hesitations, burst typing moments
- **Typo simulation** — makes nearby-key mistakes and self-corrects them
- **Works everywhere** — standard inputs, textareas, contenteditable fields, and Google Docs
- **Pause / Resume / Stop** at any time
- **Live progress badge** on the page while typing

## Installation

1. Download or clone this repo
2. Go to `chrome://extensions/` and enable **Developer mode**
3. Click **Load unpacked** and select the `humantype-extension` folder

## Usage

1. Click the HumanType icon in your toolbar
2. Paste your text and set your speed
3. Click **Start**, then click any text field on the page
4. Watch it type

## Permissions

| Permission | Why |
|---|---|
| `activeTab` | Identifies the active tab to inject the typing engine |
| `scripting` | Injects the content script into the page on demand |
| `storage` | Syncs typing state between the page and popup |
| `debugger` | Dispatches trusted keyboard events via CDP for sites that block synthetic input (Google Docs, rich text editors, etc.) |

## License

MIT
