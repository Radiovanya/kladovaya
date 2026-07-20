# Кладовая

Внутренняя single-tenant система учета аренды кладовок, гаражей и боксов.

## Что реализовано

- вход и три роли: Admin, Manager, Accountant;
- dashboard с operational KPI и фильтром по объекту;
- реестры объектов, юнитов, клиентов, договоров, начислений, оплат, задач и пользователей;
- карточка клиента со связанными договорами, начислениями, оплатами, документами и задачами;
- создание основных сущностей в демо-режиме;
- проверка пересечения активных договоров;
- автоматический статус занятого юнита;
- статусы начислений pending / partial / paid / overdue;
- PostgreSQL-схема Prisma, SQL-миграция, seed и тесты доменной логики.

## Быстрый запуск

Требуется Node.js 20+.

```bash
pnpm install
pnpm dev
```

Откройте `http://localhost:3000`. Демо-данные сохраняются в Local Storage браузера. Пароль на экране входа демонстрационный; можно выбрать любую из трех ролей.

Опубликованная версия: `https://radiovanya.github.io/kladovaya/`.

## PostgreSQL

```bash
cp .env.example .env
pnpm db:generate
pnpm db:migrate
pnpm db:seed
```

Текущая web-сборка работает в безопасном автономном демо-режиме. Для production необходимо подключить серверные route handlers к Prisma, настроить защищенную сессию и объектное хранилище файлов.

## Тесты и сборка

```bash
pnpm test
pnpm build
```

## Структура

```text
app/                  Next.js UI
lib/types.ts          доменные типы
lib/business.ts       бизнес-правила и расчеты статусов
lib/seed.ts           данные автономного демо-режима
lib/store.ts          browser repository
prisma/schema.prisma  нормализованная PostgreSQL-схема
prisma/migrations/    SQL-миграции
prisma/seed.ts        seed PostgreSQL
tests/                тесты core business logic
```

## Краткий ERD

```text
Location 1 ── N Unit 1 ── N Contract N ── 1 Customer
                         │          │
                         │          └── N Payment
                         └── N Charge 1 ── N Payment

User 1 ── N Task
Document ── polymorphic reference ── Customer | Contract | Payment
```

## Архитектурные решения

- монолитный Next.js-клиент с отдельным чистым слоем бизнес-правил;
- PostgreSQL + Prisma как целевая персистентная модель;
- опубликованная версия использует browser repository, поэтому доступна без секретов и внешней БД;
- все деньги в Prisma хранятся как `Decimal(12,2)`;
- документы представлены метаданными и URL, фактическое хранилище не навязывается;
- одна валюта (RUB), одна компания, авансы без привязки к начислению разрешены;
- удаление заменено явными статусами `archived` / `isActive`.

## Осознанно не реализовано

Нет публичного бронирования, клиентского кабинета, CRM-воронки, уведомлений, календаря, онлайн-кассы, 1С, SMS/email automation, генерации PDF/DOCX, электронной подписи, multi-tenant архитектуры, сложного BI, импорта/экспорта и audit log.

## Acceptance checklist

- [x] Login и роли
- [x] CRUD-формы основных сущностей в демо-режиме
- [x] Dashboard
- [x] Карточка клиента со связанными данными
- [x] Активный договор занимает юнит
- [x] Пересечение активных договоров запрещено
- [x] Оплата пересчитывает статус начисления
- [x] Просрочка определяется по dueDate и покрытию
- [x] Завершенные договоры не занимают юнит
- [x] Seed-данные
- [x] Prisma schema и migration
- [x] Тесты core business logic
- [x] Адаптивность для ноутбука и desktop
- [x] Автоматическая публикация статической сборки через GitHub Pages
- [ ] Production auth, серверный Prisma repository и файловое хранилище требуют инфраструктурных секретов
