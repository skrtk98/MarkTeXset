FROM ubuntu:24.04

ENV DEBIAN_FRONTEND=noninteractive

RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    pandoc \
    texlive-luatex \
    texlive-latex-recommended \
    texlive-latex-extra \
    texlive-fonts-recommended \
    texlive-lang-japanese \
    fonts-lmodern \
    fonts-noto-cjk \
  && rm -rf /var/lib/apt/lists/*

# The container runs as the caller's UID (HOME=/), so keep the luaotfload font cache in a
# prebuilt, world-writable TEXMFVAR instead of the unwritable home directory.
ENV TEXMFVAR=/var/lib/texmf-var
RUN mkdir -p "$TEXMFVAR" \
  && luaotfload-tool --update \
  && chmod -R a+rwX "$TEXMFVAR"

WORKDIR /work
COPY render.sh /usr/local/bin/mathmd-baseline
RUN chmod +x /usr/local/bin/mathmd-baseline

ENTRYPOINT ["/usr/local/bin/mathmd-baseline"]
