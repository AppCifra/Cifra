import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

// A tela segura desde o primeiro quadro (RF-41) e fora do que o sistema lê da tela: o plugin liga o
// FLAG_SECURE antes do JS, desliga a captura de conteúdo e tira a árvore do preenchimento
// automático, que monta a estrutura da tela mesmo com o FLAG_SECURE.

interface PluginDaTela {
  comTelaSegura(codigo: string): string;
}

const plugin = createRequire(import.meta.url)('../plugins/tela-segura.js') as PluginDaTela;

const MODELO = `package org.cifra.app

import android.os.Build
import android.os.Bundle

import com.facebook.react.ReactActivity

class MainActivity : ReactActivity() {
  override fun onCreate(savedInstanceState: Bundle?) {
    // Set the theme to AppTheme BEFORE onCreate to support
    // coloring the background, status bar, and navigation bar.
    // This is required for expo-splash-screen.
    setTheme(R.style.AppTheme);
    super.onCreate(null)
  }
}
`;

const ESPERADO = `package org.cifra.app

import android.view.View
import android.view.WindowManager
import android.view.contentcapture.ContentCaptureManager

import android.os.Build
import android.os.Bundle

import com.facebook.react.ReactActivity

class MainActivity : ReactActivity() {
  override fun onCreate(savedInstanceState: Bundle?) {
    window.setFlags(WindowManager.LayoutParams.FLAG_SECURE, WindowManager.LayoutParams.FLAG_SECURE)
    getSystemService(ContentCaptureManager::class.java)?.setContentCaptureEnabled(false)
    if (android.os.Build.VERSION.SDK_INT >= 33) setRecentsScreenshotEnabled(false)
    // Set the theme to AppTheme BEFORE onCreate to support
    // coloring the background, status bar, and navigation bar.
    // This is required for expo-splash-screen.
    setTheme(R.style.AppTheme);
    super.onCreate(null)
    window.decorView.importantForAutofill = View.IMPORTANT_FOR_AUTOFILL_NO_EXCLUDE_DESCENDANTS
  }
}
`;

describe('tela segura e fora do que o sistema lê (RF-41)', () => {
  it('liga o FLAG_SECURE e desliga a captura antes do tema; o preenchimento sai depois da árvore', () => {
    expect(plugin.comTelaSegura(MODELO)).toBe(ESPERADO);
  });

  it('não repete nada, nem no MainActivity de um prebuild anterior', () => {
    expect(plugin.comTelaSegura(ESPERADO)).toBe(ESPERADO);
    const anterior = MODELO.replace(
      'package org.cifra.app\n',
      'package org.cifra.app\n\nimport android.view.WindowManager\n',
    ).replace(
      '  override fun onCreate(savedInstanceState: Bundle?) {\n',
      '  override fun onCreate(savedInstanceState: Bundle?) {\n    window.setFlags(WindowManager.LayoutParams.FLAG_SECURE, WindowManager.LayoutParams.FLAG_SECURE)\n',
    );
    const atualizado = plugin.comTelaSegura(anterior);
    expect(atualizado.match(/FLAG_SECURE\)/g)).toHaveLength(1);
    expect(atualizado.match(/^import android\.view\.WindowManager$/gm)).toHaveLength(1);
    expect(atualizado).toContain('setContentCaptureEnabled(false)');
    expect(atualizado).toContain('IMPORTANT_FOR_AUTOFILL_NO_EXCLUDE_DESCENDANTS');
    expect(atualizado.match(/setRecentsScreenshotEnabled\(false\)/g)).toHaveLength(1);
  });

  it('sem o onCreate do modelo, falha em vez de gerar um app sem a tela segura', () => {
    expect(() => plugin.comTelaSegura('class MainActivity')).toThrow();
    expect(() => plugin.comTelaSegura(MODELO.replace('    super.onCreate(null)\n', ''))).toThrow();
  });

  it('o app usa o plugin', () => {
    const app = JSON.parse(readFileSync(new URL('../app.json', import.meta.url), 'utf8')) as {
      expo: { plugins: string[] };
    };
    expect(app.expo.plugins).toContain('./plugins/tela-segura.js');
  });
});
