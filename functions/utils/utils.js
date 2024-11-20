const translit = {
    'А': 'A', 'а': 'a',
    'Б': 'Б', 'б': '6',
    'В': 'B', 'в': 'в',
    'Г': 'Г', 'г': 'r',
    'Д': 'Д', 'д': 'g',
    'Е': 'E', 'е': 'e',
    'Ё': 'E', 'ё': 'e',
    'Ж': 'Ж', 'ж': 'ж',
    'З': '3', 'з': 'з',
    'И': 'U', 'и': 'u',
    'Й': 'Й', 'й': 'й',
    'К': 'K', 'к': 'k',
    'Л': 'Л', 'л': 'л',
    'М': 'M', 'м': 'm',
    'Н': 'H', 'н': 'н',
    'О': 'O', 'о': 'o',
    'П': 'П', 'п': 'n',
    'Р': 'P', 'р': 'p',
    'С': 'C', 'с': 'c',
    'Т': 'T', 'т': 'т',
    'У': 'Y', 'у': 'y',
    'Ф': 'Ф', 'ф': 'ф',
    'Х': 'X', 'х': 'x',
    'Ц': 'Ц', 'ц': 'ц',
    'Ч': 'Ч', 'ч': 'ч',
    'Ш': 'Ш', 'ш': 'ш',
    'Щ': 'Щ', 'щ': 'щ',
    'Ъ': 'Ъ', 'ъ': 'ъ',
    'Ы': 'Ы', 'ы': 'ы',
    'Ь': 'b', 'ь': 'ь',
    'Э': 'Э', 'э': 'э',
    'Ю': 'Ю', 'ю': 'ю',
    'Я': 'Я', 'я': 'я'
};

export function toLatin(str) {
    return str.split('').map(char => translit[char] || char).join('');
}