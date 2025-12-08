# Smart STT

Aplicativo Electron para gravar áudio rapidamente, transcrever com OpenAI Whisper e colar o texto no app em foco. Inclui overlay leve com atalho global e janela de configurações para chave, microfone e idioma.

## Requisitos
- Node.js 18 ou superior
- npm
- Chave da OpenAI (configurada dentro do app em Configurações)

### Dependências extras no Linux
Para que o Electron rode/crie pacotes `.deb`/`.rpm`, instale bibliotecas base:
```bash
sudo apt-get update
sudo apt-get install -y libnss3 libatk1.0-0 libx11-xcb1 libxcb-dri3-0 libxkbcommon0 libasound2
# Para gerar .deb/.rpm
sudo apt-get install -y dpkg-dev rpm fakeroot
```

## Instalação
```bash
npm install
```

## Ambiente de desenvolvimento
```bash
npm start
```
Isso abre o app com recarregamento via electron-forge + Vite. Abra Configurações e cole sua chave OpenAI antes de gravar.

## Como usar
- Inicie o app (`npm start` em dev ou o instalador gerado).
- Para abrir Configurações: use o atalho `Ctrl+Shift+O` ou clique no ícone da bandeja do sistema (menu “Configurações”). Ajuste chave OpenAI, microfone e idioma.
- Para gravar: use o atalho `Ctrl+Shift+S`. O overlay aparece no rodapé; grave, depois use o mesmo atalho para parar.
- O áudio é enviado ao Whisper, o texto é limpo e copiado para o clipboard; o app tenta colar automaticamente com Ctrl+V. Se o paste falhar, o texto permanece no clipboard.
- Hotkeys podem ser redefinidas na aba “Hotkeys” das Configurações.

## Build / pacote
O build deve ser feito no próprio sistema alvo (Windows para `.exe`, Linux para `.deb`/`.rpm`/`.zip`). O comando é o mesmo; os artefatos aparecem em `out/`.

### Windows
```powershell
npm run make
```
Gera instalador Squirrel (`.exe`) e `.zip`. Execute o `.exe` para instalar.

### Linux (Debian/Ubuntu-like)
```bash
npm run make
```
Gera `.deb`, `.rpm` e `.zip`. Instale, por exemplo:
```bash
sudo dpkg -i out/*.deb
```

## Notas
- Configurações são salvas via `electron-store` no perfil do usuário.

