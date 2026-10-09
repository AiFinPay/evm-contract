# Добавление стейблкоинов в TokenList на Robinhood Chain

## Контекст

При деплое B2BSplitter v1.4 на Robinhood Chain контракт `TokenList` был развернут с пустым списком стейблкоинов. Для работы платформы необходимо добавить два стейблкоина:

- **USDe**: `0x5d3a1Ff2b6BAb83b63cd9AD0787074081a52ef34`
- **USDG**: `0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168`

## Владельцы Safe (3 из 4 required)

| Владелец | Адрес |
|----------|-------|
| Iryna | `0x25A834b6fEC79e9ee6ED04Ef5b97440149C6Cc24` |
| Dmitry | `0x2118c57dEBD53f614DDfE464Ff2941BE6646cA82` |
| Pasha | `0x3C31dd9daCeC5473cC9B660CD69247A20701cF19` |
| Pavlo | `0x588A80e94a762C670711ff77CC60a2e65E64F53A` |

---

## Инструкция для Ledger (Pavlo)

### Шаг 1: Подготовить Ledger

1. Подключить Ledger к компьютеру
2. Открыть **Ethereum App** на устройстве
3. Убедиться, что LEDGER_ACCOUNT настроен:
   ```bash
   echo $LEDGER_ACCOUNT
   # Должно быть: 0x588A80e94a762C670711ff77CC60a2e65E64F53A
   ```

### Шаг 2: Открыть Safe UI с Ledger

1. Перейти на https://app.safe.global
2. Нажать **"Connect wallet"** → выбрать **Ledger**
3. Разрешить доступ к Ledger в браузере
4. На Ledger: открыть Ethereum App, нажать обе кнопки для подтверждения
5. Выбрать аккаунт: `0x588A80e94a762C670711ff77CC60a2e65E64F53A`
6. Выбрать Safe: **Robinhood** (`0x5AFe07483886DFa0B77C6d60212B6E52D78ac11e`)

### Шаг 3: Создать транзакцию

1. Нажать **"New transaction"** (справа вверху)
2. Выбрать **"Contract interaction"**
3. В поле **"Contract address"** вставить:
   ```
   0xbA98C0797707611787B04680E260036573D9D7a1
   ```
4. Нажать **"Next"**

### Шаг 4: Заполнить параметры setAllowed

1. Выбрать метод: **`setAllowed`**
2. Заполнить массивы:

   **_tokens (address[]):**
   ```
   0x5d3a1Ff2b6BAb83b63cd9AD0787074081a52ef34
   ```
   Нажать **"+"** добавить ещё:
   ```
   0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168
   ```

   **_allowedFlags (bool[]):**
   ```
   true
   ```
   Нажать **"+"** добавить ещё:
   ```
   true
   ```

3. Нажать **"Next"**

### Шаг 5: Подписать транзакцию на Ledger

1. Проверить данные:
   - Контракт: `0xbA98C0797707611787B04680E260036573D9D7a1`
   - Метод: `setAllowed`
   - 2 токена добавляются
2. Нажать **"Sign"**
3. На Ledger:
   - Прокрутить: **"Blind sign"** или **"Enable blind signing"** (если требуется)
   - Подтвердить транзакцию (нажать обе кнопки)
4. Транзакция появится в **"Awaiting confirmations"**

### Шаг 6: Запросить подписи от других владельцев

Отправить другим владельцам (Iryna, Dmitry, Pasha):

**Текст сообщения:**
```
Требуется подпись для добавления стейблкоинов USDe и USDG в TokenList на Robinhood Chain.

Safe: 0x5AFe07483886DFa0B77C6d60212B6E52D78ac11e (Robinhood)
Контракт: 0xbA98C0797707611787B04680E260036573D9D7a1 (TokenList)
Метод: setAllowed
Токены: USDe + USDG

Подписать: https://app.safe.global/home?safe=robinhood:0x5AFe07483886DFa0B77C6d60212B6E52D78ac11e
Нужно 3 подписи из 4
```

### Шаг 7: Исполнить транзакцию

После получения 3 подписей:
1. Вернуться в Safe UI
2. Перейти в **"Transactions"** → **"Awaiting confirmations"**
3. Нажать **"Execute"**
4. Подтвердить на Ledger

---

## Проверка результата

После исполнения проверить, что токены добавлены:

```bash
HARDHAT_NETWORK=robinhood bun run scripts/check-deployment-v14.ts
```

Ожидаемый вывод:
```
--- TokenList ---
✅ USDe (0x5d3a1Ff2b6BAb83b63cd9AD0787074081a52ef34) is allowed
✅ USDG (0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168) is allowed
✅ All on-chain checks passed.
```

---

## Ссылки

- Safe UI: https://app.safe.global/home?safe=robinhood:0x5AFe07483886DFa0B77C6d60212B6E52D78ac11e
- TokenList на Robinhood: https://robinhoodchain.blockscout.com/address/0xbA98C0797707611787B04680E260036573D9D7a1
