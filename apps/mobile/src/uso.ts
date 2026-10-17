// O uso do app (RF-40): cada toque na tela e cada letra digitada recomeçam o tempo parado do
// bloqueio sozinho. O teclado digita sem tocar na janela do app, então os campos avisam daqui.
const ouvintes = new Set<() => void>();

export function marcarUso(): void {
  for (const ouvinte of [...ouvintes]) ouvinte();
}

export function aoUsar(ouvinte: () => void): () => void {
  ouvintes.add(ouvinte);
  return () => ouvintes.delete(ouvinte);
}
