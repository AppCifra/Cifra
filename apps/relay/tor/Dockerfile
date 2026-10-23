# Tor do relay: publica o relay como onion service. Imagem e pacote travados: Alpine 3.24 pelo digest
# do índice (amd64 e arm64) e o tor na versão exata do Alpine.
FROM alpine:3.24@sha256:294b683cb724975bec92580e1e685676bd4b50bda910ddb8c51d4cabeaec77e6

RUN apk add --no-cache tor=0.4.9.14-r0 \
  && mkdir -p /var/lib/tor/cifra-relay \
  && chown -R tor /var/lib/tor \
  && chmod 700 /var/lib/tor /var/lib/tor/cifra-relay
COPY torrc /etc/tor/torrc

USER tor
CMD ["tor", "-f", "/etc/tor/torrc"]
