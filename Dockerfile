FROM --platform=$BUILDPLATFORM alpine:3.21 AS downloader
ARG TARGETARCH
ARG SAFESHARE_VERSION=v1.1.1
WORKDIR /out

RUN apk add --no-cache curl

RUN BINARY=$([ "$TARGETARCH" = "arm64" ] && echo "safeshare-linux-arm64" || echo "safeshare-linux-x64") && \
    curl -fsSL \
      "https://github.com/a7ul/safeshare/releases/download/${SAFESHARE_VERSION}/${BINARY}" \
      -o safeshare && \
    chmod +x safeshare

FROM scratch
COPY --from=downloader /out/safeshare /safeshare

EXPOSE 8000
ENV PORT=8000
ENV STORAGE_DIR=/data
ENV LINK_TTL_DAYS=30

ENTRYPOINT ["/safeshare"]
