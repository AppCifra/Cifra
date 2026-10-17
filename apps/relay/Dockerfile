# Relay do Cifra: Node 24 rodando o TypeScript direto, sem build. Sai para amd64 e arm64 (RNF-19):
# a imagem base fica travada pelo digest do índice, que vale para as duas arquiteturas, e as
# dependências saem do lockfile. O contexto do build é a raiz do repositório:
#   docker build -f apps/relay/Dockerfile .
FROM node:24-alpine@sha256:ebfe2f90462722a7a4de65e91990e97fe0d401c70e0e762c5b53302f905ec1c1 AS dependencias

ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
WORKDIR /relay
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY patches patches
COPY packages/protocol/package.json packages/protocol/
COPY apps/relay/package.json apps/relay/
RUN corepack enable && pnpm install --frozen-lockfile --prod --filter @cifra/relay...

FROM node:24-alpine@sha256:ebfe2f90462722a7a4de65e91990e97fe0d401c70e0e762c5b53302f905ec1c1

WORKDIR /relay
COPY --from=dependencias /relay ./
COPY packages/protocol/src packages/protocol/src
COPY apps/relay/src apps/relay/src
COPY apps/relay/scripts apps/relay/scripts
RUN mkdir /dados && chown node:node /dados

USER node
ENV CIFRA_ENDERECO=0.0.0.0 CIFRA_PORTA=8080 CIFRA_BANCO=/dados/relay.sqlite
EXPOSE 8080
VOLUME /dados
CMD ["node", "--no-warnings", "apps/relay/src/principal.ts"]
