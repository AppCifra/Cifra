# Imagem e pacote travados: alpine 3.22 pelo digest e tor na versão exata.
FROM alpine:3.22@sha256:5291449c3df73caf6ed85e649dec1b9e818b39a5d8c871e97afc13e9cd5e8fa8
RUN apk add --no-cache tor=0.4.9.14-r0 \
  && mkdir -p /var/lib/tor/cifra-eco \
  && chown -R tor /var/lib/tor \
  && chmod 700 /var/lib/tor /var/lib/tor/cifra-eco
COPY torrc /etc/tor/torrc
USER tor
CMD ["tor", "-f", "/etc/tor/torrc"]
