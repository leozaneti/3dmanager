export function cleanDigits(value: string) {
  return value.replace(/\D/g, "");
}

function validateCpf(digits: string) {
  if (digits.length !== 11 || /^(\d)\1{10}$/.test(digits)) return false;
  let sum = 0;
  for (let i = 0; i < 9; i++) sum += Number(digits[i]) * (10 - i);
  let rest = ((sum * 10) % 11) % 10;
  if (rest !== Number(digits[9])) return false;
  sum = 0;
  for (let i = 0; i < 10; i++) sum += Number(digits[i]) * (11 - i);
  rest = ((sum * 10) % 11) % 10;
  return rest === Number(digits[10]);
}

function validateCnpj(digits: string) {
  if (digits.length !== 14 || /^(\d)\1{13}$/.test(digits)) return false;
  const w1 = [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
  const w2 = [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
  let sum = 0;
  for (let i = 0; i < 12; i++) sum += Number(digits[i]) * w1[i];
  let rest = sum % 11;
  if (rest < 2 ? 0 : 11 - rest !== Number(digits[12])) return false;
  sum = 0;
  for (let i = 0; i < 13; i++) sum += Number(digits[i]) * w2[i];
  rest = sum % 11;
  return (rest < 2 ? 0 : 11 - rest) === Number(digits[13]);
}

export function validateDocument(value: string) {
  const digits = cleanDigits(value);
  if (!digits) return "";
  if (digits.length === 11) return validateCpf(digits) ? "" : "CPF inválido";
  if (digits.length === 14) return validateCnpj(digits) ? "" : "CNPJ inválido";
  return "CPF deve ter 11 dígitos ou CNPJ 14 dígitos";
}
