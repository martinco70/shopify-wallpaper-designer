#!/usr/bin/env bash
set -euo pipefail

# shopify-wallpaper-designer: Server dependency check
# Verifies presence and versions of ImageMagick (magick/convert/identify) and Ghostscript (gs)
# Also prints ImageMagick formats and policy and checks MAGICK_CONFIGURE_PATH

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[0;33m'; BLUE='\033[0;34m'; NC='\033[0m'
pass()  { echo -e "${GREEN}✔${NC} $*"; }
warn()  { echo -e "${YELLOW}⚠${NC} $*"; }
fail()  { echo -e "${RED}✖${NC} $*"; }
info()  { echo -e "${BLUE}i${NC}  $*"; }

echo "=== OS ==="
if [ -f /etc/os-release ]; then
  . /etc/os-release
  echo "NAME=$NAME VERSION=$VERSION ID=$ID VERSION_ID=$VERSION_ID"
else
  uname -a || true
fi

echo
echo "=== PATH ==="
echo "$PATH"

echo
echo "=== Looking for commands ==="
which magick >/dev/null 2>&1 && pass "magick found at $(command -v magick)" || warn "magick not found"
which convert >/dev/null 2>&1 && pass "convert found at $(command -v convert)" || warn "convert not found"
which identify >/dev/null 2>&1 && pass "identify found at $(command -v identify)" || warn "identify not found"
which gs >/dev/null 2>&1 && pass "gs (Ghostscript) found at $(command -v gs)" || warn "gs not found"

echo
echo "=== Versions ==="
if command -v magick >/dev/null 2>&1; then
  info "magick -version (first lines)"
  magick -version | head -n 20 || true
elif command -v convert >/dev/null 2>&1; then
  info "convert -version (ImageMagick v6 likely)"
  convert -version | head -n 20 || true
else
  fail "Neither magick nor convert available"
fi

if command -v gs >/dev/null 2>&1; then
  info "gs -version"
  gs -version || true
else
  warn "Ghostscript not installed (needed to rasterize PDF/EPS in ImageMagick)"
fi

echo
echo "=== ImageMagick formats (PDF/PS/EPS) ==="
if command -v magick >/dev/null 2>&1; then
  fmts=$(magick -list format | egrep '^(PDF|PS|EPS) ' || true)
elif command -v convert >/dev/null 2>&1; then
  fmts=$(convert -list format | egrep '^(PDF|PS|EPS) ' || true)
else
  fmts=""
fi
if [ -n "$fmts" ]; then
  echo "$fmts"
  # Expect lines like: "PDF* rw+  Portable Document Format"
  # Check for read (r) and write (w) capabilities
  if echo "$fmts" | grep -q '^PDF'; then pass "PDF coder present"; else warn "PDF coder missing"; fi
  if echo "$fmts" | grep -q '^PS';  then pass "PS coder present";  else warn "PS coder missing";  fi
  if echo "$fmts" | grep -q '^EPS'; then pass "EPS coder present"; else warn "EPS coder missing"; fi
else
  warn "Could not list ImageMagick formats"
fi

echo
echo "=== ImageMagick policy ==="
if command -v magick >/dev/null 2>&1; then
  magick -list policy || true
elif command -v convert >/dev/null 2>&1; then
  convert -list policy || true
fi

echo
echo "=== Environment ==="
echo "MAGICK_CONFIGURE_PATH=${MAGICK_CONFIGURE_PATH:-}"
if [ -n "${MAGICK_CONFIGURE_PATH:-}" ]; then
  if [ -d "$MAGICK_CONFIGURE_PATH" ]; then
    pass "MAGICK_CONFIGURE_PATH directory exists"
    if [ -f "$MAGICK_CONFIGURE_PATH/policy.xml" ]; then
      pass "policy.xml found at $MAGICK_CONFIGURE_PATH/policy.xml"
    else
      warn "policy.xml not found in MAGICK_CONFIGURE_PATH"
    fi
  else
    warn "MAGICK_CONFIGURE_PATH is set but directory does not exist"
  fi
else
  warn "MAGICK_CONFIGURE_PATH not set (repo provides backend/im-policy/policy.xml)"
fi

echo
echo "=== Quick functional test (optional) ==="
tmpdir=$(mktemp -d)
trap 'rm -rf "$tmpdir"' EXIT
cat >"$tmpdir"/t.pdf <<'PDF'
%PDF-1.1
1 0 obj<<>>endobj
2 0 obj<<>>endobj
3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 100 100]/Contents 4 0 R>>endobj
4 0 obj<</Length 44>>stream
0.9 0 0 rg 0 0 100 100 re f
BT /F1 12 Tf 10 50 Td (IM Test) Tj ET
endstream endobj
5 0 obj<</Type/Font/Subtype/Type1/BaseFont/Helvetica/Name/F1>>endobj
6 0 obj<</Type/Pages/Count 1/Kids[3 0 R]>>endobj
7 0 obj<</Type/Catalog/Pages 6 0 R>>endobj
xref
0 8
0000000000 65535 f 
0000000010 00000 n 
0000000055 00000 n 
0000000100 00000 n 
0000000195 00000 n 
0000000289 00000 n 
0000000368 00000 n 
0000000433 00000 n 
trailer<</Size 8/Root 7 0 R>>
startxref
488
%%EOF
PDF

out="$tmpdir/out.jpg"
if command -v magick >/dev/null 2>&1; then
  if magick -density 150 "$tmpdir/t.pdf[0]" -quality 85 "$out" 2>"$tmpdir/err.log"; then
    pass "magick successfully rasterized a test PDF (out.jpg size: $(stat -c%s "$out" 2>/dev/null || wc -c <"$out"))"
  else
    warn "magick failed to rasterize test PDF"; cat "$tmpdir/err.log" || true
  fi
elif command -v convert >/dev/null 2>&1; then
  if convert -density 150 "$tmpdir/t.pdf[0]" -quality 85 "$out" 2>"$tmpdir/err.log"; then
    pass "convert successfully rasterized a test PDF"
  else
    warn "convert failed to rasterize test PDF"; cat "$tmpdir/err.log" || true
  fi
fi

echo
echo "=== Summary ==="
missing=()
if ! command -v magick >/dev/null 2>&1 && ! command -v convert >/dev/null 2>&1; then missing+=(ImageMagick); fi
if ! command -v gs >/dev/null 2>&1; then missing+=(Ghostscript); fi
if [ ${#missing[@]} -eq 0 ]; then
  pass "All required CLI dependencies are present."
else
  fail "Missing: ${missing[*]}"
  echo "Install on Debian/Ubuntu: sudo apt update && sudo apt install -y imagemagick ghostscript"
fi
