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

WORKDIR /work
COPY render.sh /usr/local/bin/mathmd-baseline
RUN chmod +x /usr/local/bin/mathmd-baseline

ENTRYPOINT ["/usr/local/bin/mathmd-baseline"]
