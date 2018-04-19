const fnExpRE = /^([\w$_]+|\([^)]*?\))\s*=>|^function\s*\(/
const simplePathRE = /^[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*|\['[^']*?']|\["[^"]*?"]|\[\d+]|\[[A-Za-z_$][\w$]*])*$/

// keyCode aliases
// { [key: string]: number | Array<number> }
const keyCodes = {
    esc: 27,
    tab: 9,
    enter: 13,
    space: 32,
    up: 38,
    left: 37,
    right: 39,
    down: 40,
    'delete': [8, 46]
}

// #4868: modifiers that prevent the execution of the listener
// need to explicitly return null so that we can determine whether to remove
// the listener for .once
const genGuard = condition => `if(${condition})return null;`

// { [key: string]: string }
const modifierCode = {
    stop: '$event.stopPropagation();',
    prevent: '$event.preventDefault();',
    self: genGuard(`$event.target !== $event.currentTarget`),
    ctrl: genGuard(`!$event.ctrlKey`),
    shift: genGuard(`!$event.shiftKey`),
    alt: genGuard(`!$event.altKey`),
    meta: genGuard(`!$event.metaKey`),
    left: genGuard(`'button' in $event && $event.button !== 0`),
    middle: genGuard(`'button' in $event && $event.button !== 1`),
    right: genGuard(`'button' in $event && $event.button !== 2`)
}

export function genHandlers(events, isNative, warn) {
    let res = isNative ? 'nativeOn:{' : 'on:{'
    for (const name in events) {
        res += `"${name}":${genHandler(name, events[name])},`
    }
    return res.slice(0, -1) + '}'
}

// Generate handler code with binding params on Weex
/* istanbul ignore next */
function genWeexHandler(params, handlerCode) {
    let innerHandlerCode = handlerCode
    const exps = params.filter(exp => simplePathRE.test(exp) && exp !== '$event')
    const bindings = exps.map(exp => ({'@binding': exp}))
    const args = exps.map((exp, i) => {
        const key = `$_${i + 1}`
        innerHandlerCode = innerHandlerCode.replace(exp, key)
        return key
    })
    args.push('$event')
    return '{\n' +
        `handler:function(${args.join(',')}){${innerHandlerCode}},\n` +
        `params:${JSON.stringify(bindings)}\n` +
        '}'
}

function genHandler(name, handler) {
    if (!handler) {
        return 'function(){}'
    }

    if (Array.isArray(handler)) {
        return `[${handler.map(handler => genHandler(name, handler)).join(',')}]`
    }

    const isMethodPath = simplePathRE.test(handler.value)
    const isFunctionExpression = fnExpRE.test(handler.value)

    if (!handler.modifiers) {
        if (isMethodPath || isFunctionExpression) {
            return handler.value
        }
        /* istanbul ignore if */
        if (__WEEX__ && handler.params) {
            return genWeexHandler(handler.params, handler.value)
        }
        return `function($event){${handler.value}}` // inline statement
    } else {
        let code = ''
        let genModifierCode = ''
        const keys = []
        for (const key in handler.modifiers) {
            if (modifierCode[key]) {
                genModifierCode += modifierCode[key]
                // left/right
                if (keyCodes[key]) {
                    keys.push(key)
                }
            } else if (key === 'exact') {
                const modifiers = (handler.modifiers)
                genModifierCode += genGuard(
                    ['ctrl', 'shift', 'alt', 'meta']
                        .filter(keyModifier => !modifiers[keyModifier])
                        .map(keyModifier => `$event.${keyModifier}Key`)
                        .join('||')
                )
            } else {
                keys.push(key)
            }
        }
        if (keys.length) {
            code += genKeyFilter(keys)
        }
        // Make sure modifiers like prevent and stop get executed after key filtering
        if (genModifierCode) {
            code += genModifierCode
        }
        const handlerCode = isMethodPath
            ? handler.value + '($event)'
            : isFunctionExpression
                ? `(${handler.value})($event)`
                : handler.value
        /* istanbul ignore if */
        if (__WEEX__ && handler.params) {
            return genWeexHandler(handler.params, code + handlerCode)
        }
        return `function($event){${code}${handlerCode}}`
    }
}

function genKeyFilter(keys) {
    return `if(!('button' in $event)&&${keys.map(genFilterCode).join('&&')})return null;`
}

function genFilterCode(key) {
    const keyVal = parseInt(key, 10)
    if (keyVal) {
        return `$event.keyCode!==${keyVal}`
    }
    const code = keyCodes[key]
    return (
        `_k($event.keyCode,` +
        `${JSON.stringify(key)},` +
        `${JSON.stringify(code)},` +
        `$event.key)`
    )
}