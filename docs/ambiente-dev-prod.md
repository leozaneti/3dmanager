# Ambiente de Desenvolvimento e Produção

## Estratégia

Separação total entre ambiente de desenvolvimento (alterações no código) e produção (uso real do sistema) usando **Git + GitHub + bancos SQLite independentes**.

---

## Estrutura de Branches

| Branch | Uso | Banco |
|--------|-----|-------|
| `main` | Produção — código estável em uso | `data/prod.sqlite` |
| `dev` | Desenvolvimento — alterações e testes | `data/dev.sqlite` |

---

## Banco de Dados por Ambiente

O arquivo `server/db.ts` lê a variável `DB_ENV` para escolher o banco:

- `DB_ENV=dev` → `data/dev.sqlite`
- `DB_ENV=prod` → `data/prod.sqlite`

### Scripts no `package.json`

| Comando | Ambiente | Banco |
|---------|----------|-------|
| `npm run dev` | Desenvolvimento | `data/dev.sqlite` |
| `npm run dev:auth` | Desenvolvimento (c/ autenticação) | `data/dev.sqlite` |
| `npm run start` | Produção | `data/prod.sqlite` |
| `npm run backup` | Produção | Faz backup de `data/prod.sqlite` |

---

## Fluxo de Trabalho

### Dia a dia (usar o sistema de verdade)

```bash
git checkout main
npm run start
```

### Desenvolver alterações

```bash
git checkout dev
npm run dev
```

### Publicar alteração

```bash
# 1. Finalizar desenvolvimento na dev
git checkout dev
# ... faz as alterações, testa com npm run dev ...

# 2. Voltar pra main e mesclar
git checkout main
# (opcional) npm run backup
git merge dev

# 3. Rodar versão estável
npm run start
```

---

## Backup

- `npm run backup` — copia `data/prod.sqlite` para `data/backups/` com timestamp
- Sempre fazer backup antes de mesclar `dev` → `main`

---

## Configuração Inicial (apenas uma vez)

```bash
git init
git add .
git commit -m "v0.1"
# Criar repositório no GitHub (via navegador)
git remote add origin <url-do-repositorio>
git push -u origin main
git checkout -b dev
git push -u origin dev
```

Depois criar os bancos iniciais:

```bash
# Criar banco de dev
DB_ENV=dev npm run dev
# Criar banco de prod
DB_ENV=prod npm run start
```

---

## .gitignore

O arquivo `.gitignore` ignora:

- `node_modules/`
- `dist/`
- `dist-server/`
- `data/prod.sqlite` (dados reais não vão pro GitHub)
- `*.log`
- `.env`
