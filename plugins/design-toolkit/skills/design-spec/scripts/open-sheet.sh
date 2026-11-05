#!/bin/sh
# Opens a published sheet or page the way the reviewer chose, and always prints the link for the reply.
# A URL opens once per machine: the tab already open shows a republish on reload, so a second tab is only noise.
#
#   open-sheet.sh <url> [--mode MODE]
#
# MODE comes from --mode, else DESIGN_SPEC_OPEN, else auto:
#   auto                 arc-background where lib/arc.sh is present and that browser is running, else
#                        browser-background
#   browser-background   the default browser, left behind the app in use (open -g)
#   browser-foreground   the default browser, brought to the front
#   app-pane             nothing here: the Claude desktop app's artifact pane shows it
#   none                 nothing here: the link in the reply is enough
# lib/arc.sh, when present, makes arc-background and arc-foreground open that browser; without it they
# fall back to the default browser.
here=$(cd "$(dirname "$0")" && pwd)
url=""
mode="${DESIGN_SPEC_OPEN:-auto}"
while [ $# -gt 0 ]; do
  case "$1" in
    --mode) [ $# -ge 2 ] || { echo "open-sheet: --mode needs a value" >&2; exit 2; }; mode="$2"; shift 2 ;;
    --mode=*) mode="${1#--mode=}"; shift ;;
    *) url="$1"; shift ;;
  esac
done
if [ -z "$url" ]; then
  echo "usage: open-sheet.sh <url> [--mode MODE]" >&2
  exit 2
fi
case "$mode" in
  auto|browser-background|browser-foreground|app-pane|none|arc-background|arc-foreground) ;;
  *) echo "open-sheet: unknown mode \"$mode\"" >&2; exit 2 ;;
esac
echo "$url"

# Only macOS has an app to hand the link to; elsewhere the printed link is the whole job.
[ "$(uname)" = "Darwin" ] || exit 0

state_dir="${XDG_STATE_HOME:-$HOME/.local/state}/design-toolkit"
opened="$state_dir/opened-sheets"
grep -Fxq -- "$url" "$opened" 2>/dev/null && exit 0

open_in() {
  if [ "$1" = background ]; then open -g "$url"; else open "$url"; fi
}

arc_ready=no
if [ -f "$here/lib/arc.sh" ]; then
  . "$here/lib/arc.sh"
  arc_ready=yes
fi
if [ "$mode" = auto ]; then
  if [ "$arc_ready" = yes ] && arc_running; then mode=arc-background; else mode=browser-background; fi
fi

case "$mode" in
  app-pane|none) exit 0 ;;
  browser-*) open_in "${mode#browser-}" || exit $? ;;
  *)
    # An arc mode: fall back to the default browser, in the same place, when that browser cannot take the tab.
    place="${mode#arc-}"
    if [ "$arc_ready" != yes ] || ! arc_running || ! arc_open "$url" "$place"; then
      echo "open-sheet: the arc browser is not available, so the default browser opens it" >&2
      open_in "$place" || exit $?
    fi
    ;;
esac

# Only a tab that opened counts. A state folder that cannot be written costs an extra tab later, not this one.
{ mkdir -p "$state_dir" && echo "$url" >> "$opened"; } 2>/dev/null || true
