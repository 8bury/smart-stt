/**
 * Interface para operações de clipboard específicas de cada plataforma.
 * Define os métodos para simular ações de copiar e colar.
 */
export interface ClipboardOperations {
  /**
   * Simula o atalho Ctrl+V (ou Cmd+V no macOS) para colar texto.
   * @returns Promise que resolve quando a operação de colar é completada
   */
  simulatePaste(): Promise<void>;

  /**
   * Simula o atalho Ctrl+C (ou Cmd+C no macOS) para copiar texto selecionado.
   * @returns Promise que resolve quando a operação de copiar é completada
   */
  simulateCopy(): Promise<void>;
}
