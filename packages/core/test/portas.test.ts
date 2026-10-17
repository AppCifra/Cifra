import { describe, expect, expectTypeOf, it } from 'vitest';
import type {
  Armazenamento,
  CofreDeChaves,
  Conexao,
  Cripto,
  NomeDoSegredo,
  Protecao,
  ParDeChaves,
  PedacoDoFluxo,
  Relogio,
  Transporte,
} from '../src/index.ts';

// Os testes do núcleo rodam em Node (RNF-15). As checagens com expectTypeOf valem no
// `pnpm typecheck` e fixam o contrato que cada adaptador de plataforma precisa cumprir.

describe('portas do núcleo', () => {
  it('o pacote carrega em Node sem nenhum adaptador de plataforma', async () => {
    await expect(import('../src/index.ts')).resolves.toBeDefined();
  });

  it('Relogio devolve milissegundos e agenda com cancelamento', () => {
    expectTypeOf<Relogio['agora']>().parameters.toEqualTypeOf<[]>();
    expectTypeOf<Relogio['agora']>().returns.toEqualTypeOf<number>();
    expectTypeOf<Relogio['agendar']>().parameters.toEqualTypeOf<[number, () => void]>();
    expectTypeOf<Relogio['agendar']>().returns.toEqualTypeOf<() => void>();
  });

  it('Cripto devolve bytes, nunca texto, e acusa anexo adulterado com false', () => {
    expectTypeOf<ReturnType<Cripto['crypto_generichash']>>().toEqualTypeOf<Uint8Array>();
    expectTypeOf<ReturnType<Cripto['crypto_box_seal']>>().toEqualTypeOf<Uint8Array>();
    expectTypeOf<ReturnType<Cripto['crypto_sign_seed_keypair']>>().toEqualTypeOf<ParDeChaves>();
    expectTypeOf<ReturnType<Cripto['crypto_sign_verify_detached']>>().toEqualTypeOf<boolean>();
    expectTypeOf<ReturnType<Cripto['crypto_secretstream_xchacha20poly1305_pull']>>().toEqualTypeOf<
      PedacoDoFluxo | false
    >();
  });

  it('CofreDeChaves só conhece os segredos do SPEC e avisa quando o segredo não existe', () => {
    expectTypeOf<NomeDoSegredo>().toEqualTypeOf<
      'chave-mestra' | 'chave-da-caixa' | 'preferencias'
    >();
    expectTypeOf<ReturnType<CofreDeChaves['ler']>>().toEqualTypeOf<Promise<Uint8Array | null>>();
  });

  it('CofreDeChaves guarda com biometria ou senha, ou só preso ao aparelho', () => {
    expectTypeOf<Protecao>().toEqualTypeOf<'desbloqueio' | 'aparelho'>();
    expectTypeOf<CofreDeChaves['guardar']>().parameter(2).toEqualTypeOf<Protecao>();
  });

  it('Armazenamento e Transporte são assíncronos', () => {
    expectTypeOf<ReturnType<Armazenamento['executar']>>().toExtend<Promise<unknown>>();
    expectTypeOf<ReturnType<Armazenamento['consultar']>>().toExtend<Promise<unknown>>();
    expectTypeOf<ReturnType<Transporte['conectar']>>().toEqualTypeOf<Promise<Conexao>>();
    // O circuito é obrigatório: quem conecta decide o que o relay pode ligar a quê.
    expectTypeOf<Transporte['conectar']>().parameters.toEqualTypeOf<[string, string]>();
    expectTypeOf<ReturnType<Conexao['enviar']>>().toEqualTypeOf<Promise<void>>();
  });
});
