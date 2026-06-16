# Ambiente de Desenvolvimento e Produção

## Estratégia

Separação total entre ambiente de desenvolvimento (alterações no código) e produção (uso real do sistema) usando **Git + GitHub + bancos SQLite independentes**.

---

## Repositório

- **URL:** https://github.com/leozaneti/3dmanager
- Branches: `main` (produção) e `dev` (desenvolvimento)
- **`package-lock.json` é commitado** — garante reprodutibilidade das dependências em qualquer ambiente (CI, Docker, outro dev).

---

## Estrutura de Branches

| Branch | Uso | Banco |
|--------|-----|-------|
| `main` | Produção — código estável em uso | `data/prod.sqlite` |
| `dev` | Desenvolvimento — alterações e testes | `data/dev.sqlite` |

---

## Banco de Dados por Ambiente

O arquivo `server/db.ts` lê a variável `DB_ENV` para escolher o banco:

- `DB_ENV=dev` → `data/dev.sqlite` (padrão)
- `DB_ENV=prod` → `data/prod.sqlite`
- `DB_ENV=test` → `data/test.sqlite` (definido em `vitest.config.ts`, isolado por arquivo)

### Scripts no `package.json`

| Comando | Ambiente | Banco |
|---------|----------|-------|
| `npm run dev` | Desenvolvimento | `data/dev.sqlite` |
| `npm run dev:auth` | Desenvolvimento (c/ autenticação) | `data/dev.sqlite` |
| `npm run start` | Produção | `data/prod.sqlite` |
| `npm run backup` | Produção | Faz backup de `data/prod.sqlite` |
| `npm test` | Testes (usa vitest) | `data/test.sqlite` |

---

## Dependências e instalação

| Cenário | Comando | Por quê |
|---------|---------|--------|
| Dev local | `npm install` | Resolve range semver (mais permissivo) |
| CI / Docker / setup novo | `npm ci` | Resolve versões **exatas** do `package-lock.json` (reprodutível) |

> ⚠️ O backend depende do binário `sqlite3` CLI no PATH (não é um pacote npm). Instale com `apt install sqlite3` (Ubuntu/Debian) ou equivalente.

---

## Fluxo de Trabalho

### Dia a dia (usar o sistema de verdade)

```bash
git checkout main
npm install     # ou npm ci em setup novo
npm run start
```

### Desenvolver alterações

```bash
git checkout dev
npm install
npm run dev      # sobe backend + frontend com hot-reload
```

### Publicar alteração

```bash
# 1. Finalizar desenvolvimento na dev
git checkout dev
# ... faz as alterações, testa com npm run dev ...
npm test         # garantir que 227 testes passam

# 2. Voltar pra main e mesclar (via PR, idealmente)
git checkout main
git pull
git merge dev    # ou abrir PR no GitHub e dar merge após CI passar
npm run backup   # sempre backup antes de mesclar

# 3. Buildar e rodar versão estável
npm ci
npm run build
npm run start
```

---

## Backup

- Automático: `setInterval` no `server/index.ts` (a cada 1h, só cria 1 por dia).
- Manual: `npm run backup` — copia `data/prod.sqlite` para `data/backups/prod-{timestamp}.sqlite`.
- Política: 30 dias diários + 1 por mês (definido em `pruneBackups` em `server/index.ts`).
- Sempre fazer backup **antes** de mesclar `dev` → `main`.

---

## CI/CD (GitHub Actions)

Workflow em `.github/workflows/ci.yml` roda automaticamente em todo PR e push para `main`/`dev`:

- ✅ `tsc --noEmit` (type-check de frontend + backend)
- ✅ `npm test` (227 testes, ~3-4 min)
- ✅ `npm run build` (valida build de produção)

Para ativar branch protection: GitHub → Settings → Branches → main → "Require status checks to pass".

---

## Configuração Inicial (já executada)

```bash
git init
git add .
git commit -m "v0.1"
git remote add origin https://github.com/leozaneti/3dmanager.git
git push -u origin main --force
git checkout -b dev
git push -u origin dev
```

---

## .gitignore

O arquivo `.gitignore` ignora:

- `node_modules/`
- `dist/`
- `dist-server/`
- `data/*.sqlite` (dados não vão pro GitHub — incluindo `data/test.sqlite` que os testes criam/destroem)
- `data/*.db`
- `data/backups/`
- `*.log`
- `.env`
- `server_stderr.log` (log do `tsc` watch em dev)

---

## Limpeza do banco de teste

Os testes em `server/__tests__/helpers/setup.ts` chamam `deleteDb()` antes de cada `beforeAll` para garantir banco limpo. Em caso de corrupção manual, basta apagar `data/test.sqlite` e rodar `npm test` novamente.
