// Esquema do banco principal. Cada migração roda uma vez, em ordem, numa transação, e a versão do
// esquema fica em `PRAGMA user_version`. Migração publicada não muda: mudança nova entra como
// migração nova no fim da lista.
import type { Armazenamento } from '../portas/armazenamento.ts';

const MIGRACOES: readonly (readonly string[])[] = [
  // 1. Identidade: uma linha só, com a semente. As palavras e o ID não ficam no banco.
  [
    `CREATE TABLE identidade (
      unica INTEGER PRIMARY KEY CHECK (unica = 1),
      semente BLOB NOT NULL CHECK (length(semente) = 32)
    ) STRICT`,
  ],

  // 2. Sessão e mensagens. Os contatos são guardados pelo ID em bytes (10).
  [
    // As prekeys deste aparelho: só aqui fica a parte privada. A assinada substituída continua
    // por um tempo, para a mensagem inicial que chega atrasada.
    `CREATE TABLE prekeys_assinadas (
      numero INTEGER PRIMARY KEY CHECK (numero BETWEEN 1 AND 4294967295),
      privada BLOB NOT NULL CHECK (length(privada) = 32),
      publica BLOB NOT NULL CHECK (length(publica) = 32),
      criada_em INTEGER NOT NULL,
      substituida_em INTEGER
    ) STRICT`,
    `CREATE TABLE prekeys_avulsas (
      numero INTEGER PRIMARY KEY CHECK (numero BETWEEN 1 AND 4294967295),
      privada BLOB NOT NULL CHECK (length(privada) = 32)
    ) STRICT`,
    // O cartão deste aparelho no relay, numa linha só: o que o relay aceitou por último.
    `CREATE TABLE cartao (
      unica INTEGER PRIMARY KEY CHECK (unica = 1),
      relay TEXT NOT NULL,
      caixa_criada INTEGER NOT NULL CHECK (caixa_criada IN (0, 1)),
      prekey_assinada INTEGER,
      data INTEGER,
      publicado_em INTEGER,
      prekeys_no_relay INTEGER,
      proxima_prekey INTEGER NOT NULL
    ) STRICT`,
    // As sessões com cada contato: a posição 0 é a atual; as outras, anteriores que ainda decifram.
    `CREATE TABLE sessoes (
      contato BLOB NOT NULL CHECK (length(contato) = 10),
      posicao INTEGER NOT NULL CHECK (posicao BETWEEN 0 AND 4),
      sessao BLOB NOT NULL,
      PRIMARY KEY (contato, posicao)
    ) STRICT, WITHOUT ROWID`,
    // Chaves efêmeras de X3DH já aceitas: a mensagem inicial guardada e reenviada não reabre
    // sessão. Saem junto com a prekey assinada que usaram.
    `CREATE TABLE bases_vistas (
      base BLOB PRIMARY KEY CHECK (length(base) = 32),
      prekey_assinada INTEGER NOT NULL
    ) STRICT, WITHOUT ROWID`,
    // O cartão conferido de cada contato: diz a caixa e os relays dele. Desatualizado quando o
    // contato abre uma sessão nova: o próximo envio busca o cartão de novo.
    `CREATE TABLE destinos (
      contato BLOB PRIMARY KEY CHECK (length(contato) = 10),
      cartao BLOB NOT NULL,
      desatualizado INTEGER NOT NULL CHECK (desatualizado IN (0, 1))
    ) STRICT, WITHOUT ROWID`,
    // As mensagens de texto. A ordem é o rowid, para o índice de busca (migração 3) apontar para
    // ela. Enviadas: pendente, enviada, lida. Recebidas: recebida, lida.
    `CREATE TABLE mensagens (
      ordem INTEGER PRIMARY KEY,
      id BLOB NOT NULL UNIQUE CHECK (length(id) = 16),
      conversa BLOB NOT NULL CHECK (length(conversa) = 10),
      de_mim INTEGER NOT NULL CHECK (de_mim IN (0, 1)),
      texto TEXT NOT NULL,
      enviada_em INTEGER NOT NULL,
      recebida_em INTEGER,
      ttl INTEGER NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('pendente', 'enviada', 'lida', 'recebida'))
    ) STRICT`,
    'CREATE INDEX mensagens_por_conversa ON mensagens (conversa, enviada_em)',
    // Fila de saída: o pacote pronto, reenviado byte a byte até o relay aceitar.
    `CREATE TABLE fila (
      ordem INTEGER PRIMARY KEY,
      contato BLOB NOT NULL CHECK (length(contato) = 10),
      mensagem BLOB CHECK (mensagem IS NULL OR length(mensagem) = 16),
      pacote BLOB NOT NULL CHECK (length(pacote) = 4096),
      tentativas INTEGER NOT NULL,
      proxima_tentativa INTEGER NOT NULL
    ) STRICT`,
    'CREATE INDEX fila_por_contato ON fila (contato, ordem)',
  ],

  // 3. Busca e exclusão real. O índice de busca é FTS5 de conteúdo externo: guarda os termos de
  // cada mensagem, nunca uma cópia do texto. Com o `secure-delete` do FTS5, apagar uma mensagem
  // tira os termos dela do arquivo na hora (RNF-08). O tipo sem conteúdo (`contentless_delete`)
  // ficou de fora: ele só marca a linha apagada e deixa os termos no arquivo até a próxima fusão do
  // índice. Os gatilhos mantêm o índice igual à tabela; o `rebuild` indexa as mensagens que já
  // existiam.
  [
    `CREATE VIRTUAL TABLE busca USING fts5(
      texto,
      content = 'mensagens',
      content_rowid = 'ordem',
      tokenize = 'unicode61 remove_diacritics 2'
    )`,
    "INSERT INTO busca (busca, rank) VALUES ('secure-delete', 1)",
    "INSERT INTO busca (busca) VALUES ('rebuild')",
    `CREATE TRIGGER mensagens_entram_na_busca AFTER INSERT ON mensagens BEGIN
      INSERT INTO busca (rowid, texto) VALUES (new.ordem, new.texto);
    END`,
    `CREATE TRIGGER mensagens_saem_da_busca AFTER DELETE ON mensagens BEGIN
      INSERT INTO busca (busca, rowid, texto) VALUES ('delete', old.ordem, old.texto);
    END`,
    `CREATE TRIGGER mensagens_mudam_na_busca AFTER UPDATE OF texto ON mensagens BEGIN
      INSERT INTO busca (busca, rowid, texto) VALUES ('delete', old.ordem, old.texto);
      INSERT INTO busca (rowid, texto) VALUES (new.ordem, new.texto);
    END`,
  ],

  // 4. Contatos. Cada ID com quem há conversa: aceito (adicionado neste aparelho ou pedido aceito)
  // ou pedido (escreveu sem ser contato, RF-07); bloqueado (RF-08), verificado (RF-38) e o apelido,
  // que nunca sai do aparelho (RF-09). A nota pessoal não entra: é a conversa com o próprio ID
  // (RF-19). Quem já conversava antes desta versão entra como aceito.
  [
    `CREATE TABLE contatos (
      contato BLOB PRIMARY KEY CHECK (length(contato) = 10),
      aceito INTEGER NOT NULL CHECK (aceito IN (0, 1)),
      bloqueado INTEGER NOT NULL DEFAULT 0 CHECK (bloqueado IN (0, 1)),
      verificado INTEGER NOT NULL DEFAULT 0 CHECK (verificado IN (0, 1)),
      apelido TEXT CHECK (apelido IS NULL OR length(apelido) BETWEEN 1 AND 40),
      criado_em INTEGER NOT NULL
    ) STRICT, WITHOUT ROWID`,
    `INSERT INTO contatos (contato, aceito, criado_em)
       SELECT contato, 1, 0 FROM sessoes
       UNION SELECT conversa, 1, 0 FROM mensagens
       UNION SELECT contato, 1, 0 FROM destinos`,
    // Um aparelho por ID (RF-05): a identidade foi restaurada em outro aparelho, e este não
    // conecta mais ao relay.
    `ALTER TABLE cartao ADD COLUMN substituido INTEGER NOT NULL DEFAULT 0
       CHECK (substituido IN (0, 1))`,
  ],

  // 5. Temporárias e apagar pra todos. Cada mensagem guarda quando some (`expira_em`, nula sem
  // timer) e, quando a pessoa apaga só neste celular, até quando dá para desfazer (`desfazer_ate`):
  // até lá ela fica escondida, e depois sai de verdade. Cada contato tem o timer da conversa, o
  // instante da mudança, no relógio de quem mudou (vale a mais nova), e se ainda falta avisar o
  // contato: o timer padrão só sai junto com a primeira mensagem. As notas de sistema ficam numa
  // tabela própria, fora do índice de busca, com o instante e a última mensagem da conversa quando
  // entraram, que as põem no lugar certo entre as mensagens. Os ajustes ficam numa linha só: o
  // timer padrão das conversas novas e o timer da nota pessoal.
  [
    'ALTER TABLE mensagens ADD COLUMN expira_em INTEGER',
    'ALTER TABLE mensagens ADD COLUMN desfazer_ate INTEGER',
    'CREATE INDEX mensagens_por_prazo ON mensagens (expira_em) WHERE expira_em IS NOT NULL',
    `CREATE INDEX mensagens_por_desfazer ON mensagens (desfazer_ate)
       WHERE desfazer_ate IS NOT NULL`,
    `ALTER TABLE contatos ADD COLUMN timer INTEGER NOT NULL DEFAULT 0
       CHECK (timer = 0 OR timer BETWEEN 10 AND 604800)`,
    'ALTER TABLE contatos ADD COLUMN timer_desde INTEGER NOT NULL DEFAULT 0',
    `ALTER TABLE contatos ADD COLUMN timer_por_avisar INTEGER NOT NULL DEFAULT 0
       CHECK (timer_por_avisar IN (0, 1))`,
    `CREATE TABLE notas (
      ordem INTEGER PRIMARY KEY,
      conversa BLOB NOT NULL CHECK (length(conversa) = 10),
      tipo TEXT NOT NULL CHECK (tipo IN ('timer', 'expirou')),
      segundos INTEGER NOT NULL CHECK (segundos = 0 OR segundos BETWEEN 10 AND 604800),
      anteriores INTEGER NOT NULL CHECK (anteriores IN (0, 1)),
      instante INTEGER NOT NULL,
      depois_de INTEGER NOT NULL
    ) STRICT`,
    'CREATE INDEX notas_por_conversa ON notas (conversa, instante)',
    `CREATE TABLE ajustes (
      unica INTEGER PRIMARY KEY CHECK (unica = 1),
      timer_padrao INTEGER NOT NULL CHECK (timer_padrao = 0 OR timer_padrao BETWEEN 10 AND 604800),
      timer_da_nota INTEGER NOT NULL
        CHECK (timer_da_nota = 0 OR timer_da_nota BETWEEN 10 AND 604800)
    ) STRICT`,
    'INSERT INTO ajustes (unica, timer_padrao, timer_da_nota) VALUES (1, 0, 0)',
  ],

  // 6. Anexos e respostas. Cada mensagem diz o tipo (texto, imagem, vídeo, documento) e, se
  // responde a outra, o ID dela: a citação sai da cópia daqui, nunca de uma cópia guardada. O anexo
  // fica dentro deste banco, cifrado com a chave própria dele (o blob como chegou do relay): sai
  // pelo mesmo secure_delete das mensagens, e nada fora do banco diz quantos anexos há nem quando
  // chegaram. O blob fica na última coluna, e nenhuma leitura de lista passa por ele. Estados:
  // enviar (sobe antes da mensagem sair), enviado, local (nota pessoal), baixar, manual (a pessoa
  // cancelou ou é um pedido: só baixa ao tocar), apagar-no-relay (baixou; falta pedir ao relay para
  // apagar), baixado, indisponivel (o relay não tem mais) e invalido (não conferiu). Nos ajustes,
  // se os anexos baixam sozinhos (RF-57), ligado por padrão.
  [
    `ALTER TABLE mensagens ADD COLUMN tipo TEXT NOT NULL DEFAULT 'texto'
       CHECK (tipo IN ('texto', 'imagem', 'video', 'documento'))`,
    `ALTER TABLE mensagens ADD COLUMN resposta BLOB
       CHECK (resposta IS NULL OR length(resposta) = 16)`,
    `CREATE TABLE anexos (
      ordem INTEGER PRIMARY KEY,
      mensagem BLOB NOT NULL UNIQUE CHECK (length(mensagem) = 16),
      formato TEXT NOT NULL,
      tamanho INTEGER NOT NULL,
      capa INTEGER NOT NULL,
      largura INTEGER NOT NULL,
      altura INTEGER NOT NULL,
      duracao INTEGER NOT NULL,
      token BLOB NOT NULL CHECK (length(token) = 32),
      chave BLOB NOT NULL CHECK (length(chave) = 32),
      hash BLOB NOT NULL CHECK (length(hash) = 32),
      sha256 BLOB CHECK (sha256 IS NULL OR length(sha256) = 32),
      miniatura BLOB NOT NULL,
      estado TEXT NOT NULL CHECK (estado IN ('enviar', 'enviado', 'local', 'baixar', 'manual',
        'apagar-no-relay', 'baixado', 'indisponivel', 'invalido')),
      tentativas INTEGER NOT NULL DEFAULT 0,
      proxima_tentativa INTEGER NOT NULL DEFAULT 0,
      blob BLOB
    ) STRICT`,
    'CREATE INDEX anexos_por_estado ON anexos (estado, proxima_tentativa)',
    `ALTER TABLE ajustes ADD COLUMN baixar_sozinho INTEGER NOT NULL DEFAULT 1
       CHECK (baixar_sozinho IN (0, 1))`,
  ],

  // 7. Ajustes e privacidade. A confirmação de leitura (RF-17) e o indicador de digitação (RF-18)
  // começam desligados; o app bloqueia sozinho depois de 5 minutos parado (RF-40; 0 é ao sair do
  // app); prints e gravações saem em branco (RF-41). Tema, idioma, notificações e Tor ficam fora
  // deste banco: valem com o app bloqueado, quando ele está fechado.
  [
    `ALTER TABLE ajustes ADD COLUMN confirmacoes_de_leitura INTEGER NOT NULL DEFAULT 0
       CHECK (confirmacoes_de_leitura IN (0, 1))`,
    `ALTER TABLE ajustes ADD COLUMN indicador_de_digitacao INTEGER NOT NULL DEFAULT 0
       CHECK (indicador_de_digitacao IN (0, 1))`,
    `ALTER TABLE ajustes ADD COLUMN bloquear_sozinho INTEGER NOT NULL DEFAULT 300
       CHECK (bloquear_sozinho BETWEEN 0 AND 86400)`,
    `ALTER TABLE ajustes ADD COLUMN bloquear_capturas INTEGER NOT NULL DEFAULT 1
       CHECK (bloquear_capturas IN (0, 1))`,
  ],

  // 8. Prints bloqueados numa conversa, para os dois (RF-58), com a hora da mudança (vale a mais
  // nova, como no timer), e até onde as mensagens do contato já chegaram aqui, pelo relógio dele:
  // é o que vai no pedido de apagar a conversa nos dois celulares (RF-59). A tabela de notas é
  // refeita para aceitar as notas dos prints (o SQLite não muda um CHECK no lugar).
  [
    `ALTER TABLE contatos ADD COLUMN prints_bloqueados INTEGER NOT NULL DEFAULT 0
       CHECK (prints_bloqueados IN (0, 1))`,
    'ALTER TABLE contatos ADD COLUMN prints_desde INTEGER NOT NULL DEFAULT 0',
    'ALTER TABLE contatos ADD COLUMN recebidas_ate INTEGER NOT NULL DEFAULT 0',
    `CREATE TABLE notas_nova (
      ordem INTEGER PRIMARY KEY,
      conversa BLOB NOT NULL CHECK (length(conversa) = 10),
      tipo TEXT NOT NULL
        CHECK (tipo IN ('timer', 'expirou', 'prints-bloqueados', 'prints-liberados')),
      segundos INTEGER NOT NULL CHECK (segundos = 0 OR segundos BETWEEN 10 AND 604800),
      anteriores INTEGER NOT NULL CHECK (anteriores IN (0, 1)),
      instante INTEGER NOT NULL,
      depois_de INTEGER NOT NULL
    ) STRICT`,
    `INSERT INTO notas_nova (ordem, conversa, tipo, segundos, anteriores, instante, depois_de)
       SELECT ordem, conversa, tipo, segundos, anteriores, instante, depois_de FROM notas`,
    'DROP TABLE notas',
    'ALTER TABLE notas_nova RENAME TO notas',
    'CREATE INDEX notas_por_conversa ON notas (conversa, instante)',
  ],

  // 9. Conversas ocultas. O cofre é um segundo banco com este mesmo esquema. Cada contato guarda a
  // caixa que ele pediu para a conversa (uma caixa de conversa oculta do lado dele), com a hora do
  // pedido, no relógio dele: vale o mais novo. Só o cofre usa as outras duas tabelas: a semente da
  // caixa de cada conversa oculta e a marca de uma mudança em andamento (ocultar ou reexibir), que
  // a próxima abertura termina ou desfaz se o app parar no meio. Elas existem também no banco
  // principal, vazias, em toda instalação: não dizem nada.
  [
    `ALTER TABLE contatos ADD COLUMN caixa BLOB
       CHECK (caixa IS NULL OR length(caixa) = 32)`,
    'ALTER TABLE contatos ADD COLUMN caixa_desde INTEGER NOT NULL DEFAULT 0',
    `CREATE TABLE caixas_ocultas (
      contato BLOB PRIMARY KEY CHECK (length(contato) = 10),
      semente BLOB NOT NULL CHECK (length(semente) = 32)
    ) STRICT, WITHOUT ROWID`,
    `CREATE TABLE mudancas (
      contato BLOB PRIMARY KEY CHECK (length(contato) = 10),
      tipo TEXT NOT NULL CHECK (tipo IN ('ocultar', 'reexibir')),
      copiada INTEGER NOT NULL DEFAULT 0 CHECK (copiada IN (0, 1))
    ) STRICT, WITHOUT ROWID`,
  ],
];

export const VERSAO_DO_ESQUEMA = MIGRACOES.length;

async function versaoAtual(banco: Armazenamento): Promise<number> {
  const [linha] = await banco.consultar('PRAGMA user_version');
  const versao = linha?.['user_version'];
  if (typeof versao !== 'number') throw new Error('versão do esquema ilegível');
  return versao;
}

/**
 * Leva o banco até a versão atual do esquema. Recusa banco de uma versão mais nova do app. `ate`
 * para numa versão anterior: só os testes usam, para montar o banco de uma versão antiga.
 */
export async function migrar(banco: Armazenamento, ate = MIGRACOES.length): Promise<void> {
  const versao = await versaoAtual(banco);
  if (versao > MIGRACOES.length) throw new Error('banco de uma versão mais nova do app');
  for (const [indice, comandos] of MIGRACOES.entries()) {
    if (indice < versao || indice >= ate) continue;
    await banco.transacao(async (t) => {
      for (const comando of comandos) await t.executar(comando);
      await t.executar(`PRAGMA user_version = ${indice + 1}`);
    });
  }
}
