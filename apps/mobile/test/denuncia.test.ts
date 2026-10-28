import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { EMAIL_DO_PROJETO } from '../src/denuncia.ts';

// Denunciar (RF-63): na segurança do contato (também num pedido) e nos ajustes, o painel manda os
// crimes direto às autoridades, mostra o e-mail do projeto e copia, pela cópia sensível do ID, o
// e-mail e o ID do contato. O app não abre o e-mail nem o navegador.

const ler = (caminho: string) => readFileSync(new URL(caminho, import.meta.url), 'utf8');

describe('denunciar (RF-63)', () => {
  it('o e-mail é o contato da política e dos termos', () => {
    expect(EMAIL_DO_PROJETO).toMatch(/^[\w.+-]+@[\w-]+(?:\.[\w-]+)+$/);
    expect(ler('../../../docs/PRIVACIDADE.md')).toContain(EMAIL_DO_PROJETO);
    expect(ler('../../../docs/TERMOS.md')).toContain(EMAIL_DO_PROJETO);
  });

  it('o painel copia o e-mail e o ID pela cópia sensível, sem abrir outro app', () => {
    const painel = ler('../src/componentes/PainelDeDenuncia.tsx');
    expect(painel).toContain('conversas.copiarTexto(texto)');
    expect(painel).toContain("copiar(EMAIL_DO_PROJETO, 'email')");
    expect(painel).toContain("copiar(contato.id, 'id')");
    expect(painel).not.toMatch(/Linking|mailto:/);
    // Com a fonte do celular em 200% (RNF-18), o texto e os dois botões não cabem: o painel rola.
    expect(painel).toMatch(/<Painel\n(?:\s+\w+(?:=\{[^}]*\})?\n)*\s+rolavel\n/);
  });

  it('o painel fica na segurança do contato, com o ID, e nos ajustes, sem contato', () => {
    const seguranca = ler('../src/telas/Seguranca.tsx');
    expect(seguranca).toContain('<PainelDeDenuncia');
    expect(seguranca).toContain('contato={{ id: resumo.id, nome }}');
    // A linha aparece em contato e em pedido, bloqueado ou não.
    expect(seguranca).toMatch(/\n {10}<LinhaDeValor\n {12}rotulo=\{t\('seguranca\.denunciar'\)\}/);

    const ajustes = ler('../src/telas/Ajustes.tsx');
    expect(ajustes).toContain('<PainelDeDenuncia');
    expect(ajustes).not.toContain('contato={');
  });
});
