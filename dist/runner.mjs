import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join as join$1 } from 'node:path';
import { tmpdir } from 'node:os';
import { execFile as execFile$1 } from 'node:child_process';

// Don't change, this corresponds to DateTimeKind.Kind enum values in .NET
const DateTimeKind = {
    Unspecified: 0,
    Utc: 1,
    Local: 2,
};
// Exception is intentionally not derived from Error, for performance reasons (see #2160)
class Exception {
    message;
    stack;
    // Typed non-nullable to match how Fable models .NET reference types: nullability
    // annotations are erased, so consumers (and `get_InnerException`) see `Exception`.
    // At runtime this is `undefined` when no inner exception was provided, just like
    // a `defaultOf()` value, which is fine for code that reads `.InnerException`.
    innerException;
    constructor(msg, innerException) {
        this.message = msg ?? "";
        this.innerException = innerException;
    }
    toString() {
        return this.message;
    }
}
function isException(x) {
    return x instanceof Exception || x instanceof Error;
}
function isPromise(x) {
    return x instanceof Promise;
}
function ensureErrorOrException(e) {
    // Exceptionally admitting promises as errors for compatibility with React.suspense (see #3298)
    return (isException(e) || isPromise(e)) ? e : new Exception(String(e));
}
function isArrayLike(x) {
    return Array.isArray(x) || ArrayBuffer.isView(x);
}
function isEnumerable(x) {
    return x != null && typeof x.GetEnumerator === "function";
}
function isComparable(x) {
    return x != null && typeof x.CompareTo === "function";
}
function isEquatable(x) {
    return x != null && typeof x.Equals === "function";
}
function isHashable(x) {
    return x != null && typeof x.GetHashCode === "function";
}
function isDisposable(x) {
    return x != null && typeof x.Dispose === "function";
}
function disposeSafe(x) {
    if (isDisposable(x)) {
        x.Dispose();
    }
}
function defaultOf() {
    return null;
}
function sameConstructor(x, y) {
    return Object.getPrototypeOf(x)?.constructor === Object.getPrototypeOf(y)?.constructor;
}
class Enumerator {
    current = defaultOf();
    iter;
    constructor(iter) { this.iter = iter; }
    ["System.Collections.Generic.IEnumerator`1.get_Current"]() {
        return this.current;
    }
    ["System.Collections.IEnumerator.get_Current"]() {
        return this.current;
    }
    ["System.Collections.IEnumerator.MoveNext"]() {
        const cur = this.iter.next();
        this.current = cur.value;
        return !cur.done;
    }
    ["System.Collections.IEnumerator.Reset"]() {
        throw new Exception("JS iterators cannot be reset");
    }
    Dispose() {
        return;
    }
}
function getEnumerator(e) {
    if (isEnumerable(e)) {
        return e.GetEnumerator();
    }
    else {
        return new Enumerator(e[Symbol.iterator]());
    }
}
function toIterator(en) {
    return {
        next() {
            const hasNext = en["System.Collections.IEnumerator.MoveNext"]();
            const current = hasNext ? en["System.Collections.Generic.IEnumerator`1.get_Current"]() : undefined;
            return { done: !hasNext, value: current };
        },
    };
}
function padWithZeros(i, length) {
    return i.toString(10).padStart(length, "0");
}
function dateOffset(date) {
    const date1 = date;
    return typeof date1.offset === "number"
        ? date1.offset
        : (date.kind === DateTimeKind.Utc
            ? 0 : date.getTimezoneOffset() * -6e4);
}
function int32ToString(i, radix) {
    i = i;
    return i.toString(radix);
}
class ObjectRef {
    static id(o) {
        if (!ObjectRef.idMap.has(o)) {
            ObjectRef.idMap.set(o, ++ObjectRef.count);
        }
        return ObjectRef.idMap.get(o);
    }
    static idMap = new WeakMap();
    static count = 0;
}
function stringHash(s) {
    let i = 0;
    let h = 5381;
    const len = s.length;
    while (i < len) {
        h = (h * 33) ^ s.charCodeAt(i++);
    }
    return h;
}
function numberHash(x) {
    return x * 2654435761 | 0;
}
function bigintHash(x) {
    return stringHash(x.toString(32));
}
// From https://stackoverflow.com/a/37449594
function combineHashCodes(hashes) {
    let h1 = 0;
    const len = hashes.length;
    for (let i = 0; i < len; i++) {
        const h2 = hashes[i];
        h1 = ((h1 << 5) + h1) ^ h2;
    }
    return h1;
}
function dateHash(x) {
    return x.getTime();
}
function arrayHash(x) {
    const len = x.length;
    const hashes = new Array(len);
    for (let i = 0; i < len; i++) {
        hashes[i] = structuralHash(x[i]);
    }
    return combineHashCodes(hashes);
}
function structuralHash(x) {
    if (x == null) {
        return 0;
    }
    switch (typeof x) {
        case "boolean":
            return x ? 1 : 0;
        case "number":
            return numberHash(x);
        case "bigint":
            return bigintHash(x);
        case "string":
            return stringHash(x);
        default: {
            if (isHashable(x)) {
                return x.GetHashCode();
            }
            else if (isArrayLike(x)) {
                return arrayHash(x);
            }
            else if (x instanceof Date) {
                return dateHash(x);
            }
            else if (Object.getPrototypeOf(x)?.constructor === Object) {
                // TODO: check call-stack to prevent cyclic objects?
                const hashes = Object.values(x).map((v) => structuralHash(v));
                return combineHashCodes(hashes);
            }
            else {
                // Classes don't implement GetHashCode by default, but must use identity hashing
                return numberHash(ObjectRef.id(x));
                // return stringHash(String(x));
            }
        }
    }
}
function equalArraysWith(x, y, eq) {
    if (x == null) {
        return y == null;
    }
    if (y == null) {
        return false;
    }
    if (x.length !== y.length) {
        return false;
    }
    for (let i = 0; i < x.length; i++) {
        if (!eq(x[i], y[i])) {
            return false;
        }
    }
    return true;
}
function equalArrays(x, y) {
    return equalArraysWith(x, y, equals$1);
}
function equalObjects(x, y) {
    const xKeys = Object.keys(x);
    const yKeys = Object.keys(y);
    if (xKeys.length !== yKeys.length) {
        return false;
    }
    xKeys.sort();
    yKeys.sort();
    for (let i = 0; i < xKeys.length; i++) {
        if (xKeys[i] !== yKeys[i] || !equals$1(x[xKeys[i]], y[yKeys[i]])) {
            return false;
        }
    }
    return true;
}
function equals$1(x, y) {
    if (x === y) {
        return true;
    }
    else if (x == null) {
        return y == null;
    }
    else if (y == null) {
        return false;
    }
    else if (isEquatable(x)) {
        return x.Equals(y);
    }
    else if (isArrayLike(x)) {
        return isArrayLike(y) && equalArrays(x, y);
    }
    else if (typeof x !== "object") {
        return false;
    }
    else if (x instanceof Date) {
        return (y instanceof Date) && compareDates(x, y) === 0;
    }
    else {
        return Object.getPrototypeOf(x)?.constructor === Object && equalObjects(x, y);
    }
}
function compareDates(x, y) {
    let xtime;
    let ytime;
    // DateTimeOffset and DateTime deals with equality differently.
    if ("offset" in x && "offset" in y) {
        xtime = x.getTime();
        ytime = y.getTime();
    }
    else {
        xtime = x.getTime() + dateOffset(x);
        ytime = y.getTime() + dateOffset(y);
    }
    return xtime === ytime ? 0 : (xtime < ytime ? -1 : 1);
}
function comparePrimitives(x, y) {
    if (x === y) {
        return 0;
    }
    if (x < y) {
        return -1;
    }
    if (x > y) {
        return 1;
    }
    // Neither equal nor ordered: at least one operand is NaN.
    // Match .NET Double.CompareTo: NaN equals NaN and is less than any other value.
    return Number.isNaN(x) ? (Number.isNaN(y) ? 0 : -1) : 1;
}
function compareArraysWith(x, y, comp) {
    if (x == null) {
        return y == null ? 0 : 1;
    }
    if (y == null) {
        return -1;
    }
    if (x.length !== y.length) {
        return x.length < y.length ? -1 : 1;
    }
    for (let i = 0, j = 0; i < x.length; i++) {
        j = comp(x[i], y[i]);
        if (j !== 0) {
            return j;
        }
    }
    return 0;
}
function compareArrays(x, y) {
    return compareArraysWith(x, y, compare$1);
}
function compareObjects(x, y) {
    const xKeys = Object.keys(x);
    const yKeys = Object.keys(y);
    if (xKeys.length !== yKeys.length) {
        return xKeys.length < yKeys.length ? -1 : 1;
    }
    xKeys.sort();
    yKeys.sort();
    for (let i = 0, j = 0; i < xKeys.length; i++) {
        const key = xKeys[i];
        if (key !== yKeys[i]) {
            return key < yKeys[i] ? -1 : 1;
        }
        else {
            j = compare$1(x[key], y[key]);
            if (j !== 0) {
                return j;
            }
        }
    }
    return 0;
}
function compare$1(x, y) {
    if (x === y) {
        return 0;
    }
    else if (x == null) {
        return y == null ? 0 : -1;
    }
    else if (y == null) {
        return 1;
    }
    else if (isComparable(x)) {
        return x.CompareTo(y);
    }
    else if (isArrayLike(x)) {
        return isArrayLike(y) ? compareArrays(x, y) : -1;
    }
    else if (typeof x !== "object") {
        return comparePrimitives(x, y);
    }
    else if (x instanceof Date) {
        return y instanceof Date ? compareDates(x, y) : -1;
    }
    else {
        return Object.getPrototypeOf(x)?.constructor === Object ? compareObjects(x, y) : -1;
    }
}
const curried = new WeakMap();
function curry2(f) {
    return curried.get(f) ?? ((a1) => (a2) => f(a1, a2));
}

function seqToString(self) {
    let count = 0;
    let str = "[";
    for (const x of self) {
        if (count === 0) {
            str += toStringQuoted(x);
        }
        else if (count === 100) {
            str += "; ...";
            break;
        }
        else {
            str += "; " + toStringQuoted(x);
        }
        count++;
    }
    return str + "]";
}
// Structured (%A-style) rendering of a value used as an element/field of a
// container. F#'s structured formatting (which records, unions, lists, etc.
// use in their ToString) quotes strings, e.g. `["a"; "b"]` and `{ Name = "John" }`.
function toStringQuoted(x, callStack = 0) {
    return typeof x === "string" ? "\"" + x + "\"" : toString$2(x, callStack);
}
function toString$2(x, callStack = 0) {
    if (x != null && typeof x === "object") {
        if (typeof x.toString === "function" && x.toString !== Object.prototype.toString) {
            return x.toString();
        }
        else if (Symbol.iterator in x) {
            return seqToString(x);
        }
        else { // TODO: Date?
            const cons = Object.getPrototypeOf(x)?.constructor;
            return cons === Object && callStack < 10
                // Same format as recordToString
                ? "{ " + Object.entries(x).map(([k, v]) => k + " = " + toStringQuoted(v, callStack + 1)).join("\n  ") + " }"
                : cons?.name ?? "";
        }
    }
    return String(x);
}
function unionToString(name, fields) {
    if (fields.length === 0) {
        return name;
    }
    else {
        let fieldStr;
        let withParens = true;
        if (fields.length === 1) {
            fieldStr = toStringQuoted(fields[0]);
            withParens = fieldStr.indexOf(" ") >= 0;
        }
        else {
            fieldStr = fields.map((x) => toStringQuoted(x)).join(", ");
        }
        return name + (withParens ? " (" : " ") + fieldStr + (withParens ? ")" : "");
    }
}
class Union {
    get name() {
        return this.cases()[this.tag];
    }
    toJSON() {
        return this.fields.length === 0 ? this.name : [this.name].concat(this.fields);
    }
    toString() {
        return unionToString(this.name, this.fields);
    }
    GetHashCode() {
        const hashes = this.fields.map((x) => structuralHash(x));
        hashes.splice(0, 0, numberHash(this.tag));
        return combineHashCodes(hashes);
    }
    Equals(other) {
        if (this === other) {
            return true;
        }
        else if (!sameConstructor(this, other)) {
            return false;
        }
        else if (this.tag === other.tag) {
            return equalArrays(this.fields, other.fields);
        }
        else {
            return false;
        }
    }
    CompareTo(other) {
        if (this === other) {
            return 0;
        }
        else if (!sameConstructor(this, other)) {
            return -1;
        }
        else if (this.tag === other.tag) {
            return compareArrays(this.fields, other.fields);
        }
        else {
            return this.tag < other.tag ? -1 : 1;
        }
    }
}
function recordToJSON(self) {
    const o = {};
    const keys = Object.keys(self);
    for (let i = 0; i < keys.length; i++) {
        o[keys[i]] = self[keys[i]];
    }
    return o;
}
function recordToString(self) {
    return "{ " + Object.entries(self).map(([k, v]) => k + " = " + toStringQuoted(v)).join("\n  ") + " }";
}
function recordGetHashCode(self) {
    const hashes = Object.values(self).map((v) => structuralHash(v));
    return combineHashCodes(hashes);
}
function recordEquals(self, other) {
    if (self === other) {
        return true;
    }
    else if (!sameConstructor(self, other)) {
        return false;
    }
    else {
        const thisNames = Object.keys(self);
        for (let i = 0; i < thisNames.length; i++) {
            if (!equals$1(self[thisNames[i]], other[thisNames[i]])) {
                return false;
            }
        }
        return true;
    }
}
function recordCompareTo(self, other) {
    if (self === other) {
        return 0;
    }
    else if (!sameConstructor(self, other)) {
        return -1;
    }
    else {
        const thisNames = Object.keys(self);
        for (let i = 0; i < thisNames.length; i++) {
            const result = compare$1(self[thisNames[i]], other[thisNames[i]]);
            if (result !== 0) {
                return result;
            }
        }
        return 0;
    }
}
class Record {
    toJSON() { return recordToJSON(this); }
    toString() { return recordToString(this); }
    GetHashCode() { return recordGetHashCode(this); }
    Equals(other) { return recordEquals(this, other); }
    CompareTo(other) { return recordCompareTo(this, other); }
}
class FSharpRef {
    getter;
    setter;
    get contents() {
        return this.getter();
    }
    set contents(v) {
        this.setter(v);
    }
    constructor(contentsOrGetter, setter) {
        if (typeof setter === "function") {
            this.getter = contentsOrGetter;
            this.setter = setter;
        }
        else {
            this.getter = () => contentsOrGetter;
            this.setter = (v) => { contentsOrGetter = v; };
        }
    }
}

// Adapted from https://github.com/MikeMcl/big.js/blob/0f94dc9110d55c4f324a47ba6a2e832ce23ac589/big.mjs
var P = {};
/*
 *  big.js v6.0.3
 *  A small, fast, easy-to-use library for arbitrary-precision decimal arithmetic.
 *  Copyright (c) 2020 Michael Mclaughlin
 *  https://github.com/MikeMcl/big.js/LICENCE.md
 */
/************************************** EDITABLE DEFAULTS *****************************************/
// The default values below must be integers within the stated ranges.
/*
 * The maximum number of decimal places (DP) of the results of operations involving division:
 * div and sqrt, and pow with negative exponents.
 */
var DP = 28, // 0 to MAX_DP
/*
 * The rounding mode (RM) used when rounding to the above decimal places.
 *
 *  0  Towards zero (i.e. truncate, no rounding).       (ROUND_DOWN)
 *  1  To nearest neighbour. If equidistant, round up.  (ROUND_HALF_UP)
 *  2  To nearest neighbour. If equidistant, to even.   (ROUND_HALF_EVEN)
 *  3  Away from zero.                                  (ROUND_UP)
 */
RM = 1, // 0, 1, 2 or 3
// The maximum value of DP and Big.DP.
MAX_DP = 1E6, // 0 to 1000000
// The maximum magnitude of the exponent argument to the pow method.
MAX_POWER = 1E6, // 1 to 1000000
/*
 * The negative exponent (NE) at and beneath which toString returns exponential notation.
 * (JavaScript numbers: -7)
 * -1000000 is the minimum recommended exponent value of a Big.
 */
NE = -29, // 0 to -1000000
/*
 * The positive exponent (PE) at and above which toString returns exponential notation.
 * (JavaScript numbers: 21)
 * 1000000 is the maximum recommended exponent value of a Big, but this limit is not enforced.
 */
PE = 29, // 0 to 1000000
/*
 * When true, an error will be thrown if a primitive number is passed to the Big constructor,
 * or if valueOf is called, or if toNumber is called on a Big which cannot be converted to a
 * primitive number without a loss of precision.
 */
STRICT = false, // true or false
/**************************************************************************************************/
// Error messages.
NAME = '[big.js] ', INVALID = NAME + 'Invalid ', INVALID_DP = INVALID + 'decimal places', INVALID_RM = INVALID + 'rounding mode', DIV_BY_ZERO = NAME + 'Division by zero', UNDEFINED = void 0, NUMERIC = /^-?(\d+(\.\d*)?|\.\d+)(e[+-]?\d+)?$/i;
/*
 * Create and return a Big constructor.
 */
function _Big_() {
    /*
     * The Big constructor and exported function.
     * Create and return a new instance of a Big number object.
     *
     * n {number|string|Big} A numeric value.
     */
    function Big(n) {
        var x = this;
        // Enable constructor usage without new.
        if (!(x instanceof Big))
            return n === UNDEFINED ? _Big_() : new Big(n);
        // Duplicate.
        if (n instanceof Big) {
            x.s = n.s;
            x.e = n.e;
            x.c = n.c.slice();
            normalize(x);
        }
        else {
            if (typeof n !== 'string') {
                if (Big.strict === true) {
                    throw TypeError(INVALID + 'number');
                }
                // Minus zero?
                n = n === 0 && 1 / n < 0 ? '-0' : String(n);
            }
            parse$4(x, n);
        }
        // Retain a reference to this Big constructor.
        // Shadow Big.prototype.constructor which points to Object.
        x.constructor = Big;
    }
    Big.prototype = P;
    Big.DP = DP;
    Big.RM = RM;
    Big.NE = NE;
    Big.PE = PE;
    Big.strict = STRICT;
    return Big;
}
function normalize(x) {
    // x = round(x, DP, 0);
    if (x.c.length > 1 && !x.c[0]) {
        let i = x.c.findIndex(x => x);
        x.c = x.c.slice(i);
        x.e = x.e - i;
    }
}
/*
 * Parse the number or string value passed to a Big constructor.
 *
 * x {Big} A Big number instance.
 * n {number|string} A numeric value.
 */
function parse$4(x, n) {
    var e, i, nl;
    if (!NUMERIC.test(n)) {
        throw Error(INVALID + 'number');
    }
    // Determine sign.
    x.s = n.charAt(0) == '-' ? (n = n.slice(1), -1) : 1;
    // Decimal point?
    if ((e = n.indexOf('.')) > -1)
        n = n.replace('.', '');
    // Exponential form?
    if ((i = n.search(/e/i)) > 0) {
        // Determine exponent.
        if (e < 0)
            e = i;
        e += +n.slice(i + 1);
        n = n.substring(0, i);
    }
    else if (e < 0) {
        // Integer.
        e = n.length;
    }
    nl = n.length;
    // Determine leading zeros before decimal point.
    for (i = 0; i < e && i < nl && n.charAt(i) == '0';)
        ++i;
    // original version (ignores decimal point).
    // // Determine leading zeros.
    // for (i = 0; i < nl && n.charAt(i) == '0';) ++i;
    if (i == nl) {
        // Zero.
        x.c = [x.e = 0];
    }
    else {
        x.e = e - i - 1;
        x.c = [];
        // Convert string to array of digits without leading zeros
        for (e = 0; i < nl;)
            x.c[e++] = +n.charAt(i++);
        // older version (doesn't keep trailing zeroes).
        // // Determine trailing zeros.
        // for (; nl > 0 && n.charAt(--nl) == '0';);
        // // Convert string to array of digits without leading/trailing zeros.
        // for (e = 0; i <= nl;) x.c[e++] = +n.charAt(i++);
    }
    x = round(x, Big.DP + 1, Big.RM);
    return x;
}
/*
 * Round Big x to a maximum of sd significant digits using rounding mode rm.
 *
 * x {Big} The Big to round.
 * sd {number} Significant digits: integer, 0 to MAX_DP inclusive.
 * rm {number} Rounding mode: 0 (down), 1 (half-up), 2 (half-even) or 3 (up).
 * [more] {boolean} Whether the result of division was truncated.
 */
function round(x, sd, rm, more) {
    var xc = x.c;
    if (rm === UNDEFINED)
        rm = Big.RM;
    if (rm !== 0 && rm !== 1 && rm !== 2 && rm !== 3) {
        throw Error(INVALID_RM);
    }
    if (sd < 1) {
        more =
            rm === 3 && (more || !!xc[0]) || sd === 0 && (rm === 1 && xc[0] >= 5 ||
                rm === 2 && (xc[0] > 5 || xc[0] === 5 && (more || xc[1] !== UNDEFINED)));
        xc.length = 1;
        if (more) {
            // 1, 0.1, 0.01, 0.001, 0.0001 etc.
            x.e = x.e - sd + 1;
            xc[0] = 1;
        }
        else {
            // Zero.
            xc[0] = x.e = 0;
        }
    }
    else if (sd < xc.length) {
        // xc[sd] is the digit after the digit that may be rounded up.
        const isZero = xc.findIndex((xci, idx) => idx >= sd && xci > 0) < 0;
        more =
            rm === 1 && xc[sd] >= 5 ||
                rm === 2 && (xc[sd] > 5 || xc[sd] === 5 &&
                    (more || xc[sd + 1] !== UNDEFINED || xc[sd - 1] & 1)) ||
                rm === 3 && (more || !isZero);
        // Remove any digits after the required precision.
        xc.length = sd--;
        // Round up?
        if (more) {
            // Rounding up may mean the previous digit has to be rounded up.
            for (; ++xc[sd] > 9;) {
                xc[sd] = 0;
                if (!sd--) {
                    ++x.e;
                    xc.unshift(1);
                }
            }
        }
        // Remove trailing zeros.
        for (sd = xc.length; !xc[--sd];)
            xc.pop();
    }
    return x;
}
/*
 * Return a string representing the value of Big x in normal or exponential notation.
 * Handles P.toExponential, P.toFixed, P.toJSON, P.toPrecision, P.toString and P.valueOf.
 */
function stringify(x, doExponential, isNonzero) {
    var e = x.e, s = x.c.join(''), n = s.length;
    // Exponential notation?
    if (doExponential) {
        s = s.charAt(0) + (n > 1 ? '.' + s.slice(1) : '') + (e < 0 ? 'e' : 'e+') + e;
        // Normal notation.
    }
    else if (e < 0) {
        for (; ++e;)
            s = '0' + s;
        s = '0.' + s;
    }
    else if (e > 0) {
        if (++e > n) {
            for (e -= n; e--;)
                s += '0';
        }
        else if (e < n) {
            s = s.slice(0, e) + '.' + s.slice(e);
        }
    }
    else if (n > 1) {
        s = s.charAt(0) + '.' + s.slice(1);
    }
    return x.s < 0 && isNonzero ? '-' + s : s;
}
// Prototype/instance methods
/*
 * Return a new Big whose value is the absolute value of this Big.
 */
P.abs = function () {
    var x = new this.constructor(this);
    x.s = 1;
    return x;
};
/*
 * Return 1 if the value of this Big is greater than the value of Big y,
 *       -1 if the value of this Big is less than the value of Big y, or
 *        0 if they have the same value.
 */
P.cmp = function (y) {
    var isneg, Big = this.constructor, x = new Big(this), y = new Big(y), xc = x.c, yc = y.c, i = x.s, j = y.s, k = x.e, l = y.e;
    // Either zero?
    if (!xc[0] || !yc[0])
        return !xc[0] ? !yc[0] ? 0 : -j : i;
    // Signs differ?
    if (i != j)
        return i;
    isneg = i < 0;
    // Compare exponents.
    if (k != l)
        return k > l ^ isneg ? 1 : -1;
    // Compare digit by digit.
    j = Math.max(xc.length, yc.length);
    for (i = 0; i < j; i++) {
        k = i < xc.length ? xc[i] : 0;
        l = i < yc.length ? yc[i] : 0;
        if (k != l)
            return k > l ^ isneg ? 1 : -1;
    }
    return 0;
    // original version (doesn't compare well trailing zeroes, e.g. 1.0 with 1.00)
    // j = (k = xc.length) < (l = yc.length) ? k : l;
    // // Compare digit by digit.
    // for (i = -1; ++i < j;) {
    //   if (xc[i] != yc[i]) return xc[i] > yc[i] ^ isneg ? 1 : -1;
    // }
    // // Compare lengths.
    // return k == l ? 0 : k > l ^ isneg ? 1 : -1;
};
/*
 * Return a new Big whose value is the value of this Big divided by the value of Big y, rounded,
 * if necessary, to a maximum of Big.DP decimal places using rounding mode Big.RM.
 */
P.div = function (y) {
    var Big = this.constructor, x = new Big(this), y = new Big(y), a = x.c, // dividend
    b = y.c, // divisor
    k = x.s == y.s ? 1 : -1, dp = Big.DP;
    if (dp !== ~~dp || dp < 0 || dp > MAX_DP) {
        throw Error(INVALID_DP);
    }
    // Divisor is zero?
    if (!b[0]) {
        throw Error(DIV_BY_ZERO);
    }
    // Dividend is 0? Return +-0.
    if (!a[0]) {
        y.s = k;
        y.c = [y.e = 0];
        return y;
    }
    var bl, bt, n, cmp, ri, bz = b.slice(), ai = bl = b.length, al = a.length, r = a.slice(0, bl), // remainder
    rl = r.length, q = y, // quotient
    qc = q.c = [], qi = 0, p = dp + (q.e = x.e - y.e) + 1; // precision of the result
    q.s = k;
    k = p < 0 ? 0 : p;
    // Create version of divisor with leading zero.
    bz.unshift(0);
    // Add zeros to make remainder as long as divisor.
    for (; rl++ < bl;)
        r.push(0);
    do {
        // n is how many times the divisor goes into current remainder.
        for (n = 0; n < 10; n++) {
            // Compare divisor and remainder.
            if (bl != (rl = r.length)) {
                cmp = bl > rl ? 1 : -1;
            }
            else {
                for (ri = -1, cmp = 0; ++ri < bl;) {
                    if (b[ri] != r[ri]) {
                        cmp = b[ri] > r[ri] ? 1 : -1;
                        break;
                    }
                }
            }
            // If divisor < remainder, subtract divisor from remainder.
            if (cmp < 0) {
                // Remainder can't be more than 1 digit longer than divisor.
                // Equalise lengths using divisor with extra leading zero?
                for (bt = rl == bl ? b : bz; rl;) {
                    if (r[--rl] < bt[rl]) {
                        ri = rl;
                        for (; ri && !r[--ri];)
                            r[ri] = 9;
                        --r[ri];
                        r[rl] += 10;
                    }
                    r[rl] -= bt[rl];
                }
                for (; !r[0];)
                    r.shift();
            }
            else {
                break;
            }
        }
        // Add the digit n to the result array.
        qc[qi++] = cmp ? n : ++n;
        // Update the remainder.
        if (r[0] && cmp)
            r[rl] = a[ai] || 0;
        else
            r = [a[ai]];
    } while ((ai++ < al || r[0] !== UNDEFINED) && k--);
    // Leading zero? Do not remove if result is simply zero (qi == 1).
    if (!qc[0] && qi != 1) {
        // There can't be more than one zero.
        qc.shift();
        q.e--;
        p--;
    }
    // Round?
    if (qi > p)
        round(q, p, Big.RM, r[0] !== UNDEFINED);
    return q;
};
/*
 * Return true if the value of this Big is equal to the value of Big y, otherwise return false.
 */
P.eq = function (y) {
    return this.cmp(y) === 0;
};
/*
 * Return true if the value of this Big is greater than the value of Big y, otherwise return
 * false.
 */
P.gt = function (y) {
    return this.cmp(y) > 0;
};
/*
 * Return true if the value of this Big is greater than or equal to the value of Big y, otherwise
 * return false.
 */
P.gte = function (y) {
    return this.cmp(y) > -1;
};
/*
 * Return true if the value of this Big is less than the value of Big y, otherwise return false.
 */
P.lt = function (y) {
    return this.cmp(y) < 0;
};
/*
 * Return true if the value of this Big is less than or equal to the value of Big y, otherwise
 * return false.
 */
P.lte = function (y) {
    return this.cmp(y) < 1;
};
/*
 * Return a new Big whose value is the value of this Big minus the value of Big y.
 */
P.minus = P.sub = function (y) {
    var i, j, t, xlty, Big = this.constructor, x = new Big(this), y = new Big(y), a = x.s, b = y.s;
    // Signs differ?
    if (a != b) {
        y.s = -b;
        return x.plus(y);
    }
    var xc = x.c.slice(), xe = x.e, yc = y.c, ye = y.e;
    // Either zero?
    if (!xc[0] || !yc[0]) {
        if (yc[0]) {
            y.s = -b;
        }
        else if (xc[0]) {
            y = new Big(x);
        }
        else {
            y.s = 1;
        }
        return y;
    }
    // Determine which is the bigger number. Prepend zeros to equalise exponents.
    if (a = xe - ye) {
        if (xlty = a < 0) {
            a = -a;
            t = xc;
        }
        else {
            ye = xe;
            t = yc;
        }
        t.reverse();
        for (b = a; b--;)
            t.push(0);
        t.reverse();
    }
    else {
        // Exponents equal. Check digit by digit.
        j = ((xlty = xc.length < yc.length) ? xc : yc).length;
        for (a = b = 0; b < j; b++) {
            if (xc[b] != yc[b]) {
                xlty = xc[b] < yc[b];
                break;
            }
        }
    }
    // x < y? Point xc to the array of the bigger number.
    if (xlty) {
        t = xc;
        xc = yc;
        yc = t;
        y.s = -y.s;
    }
    /*
     * Append zeros to xc if shorter. No need to add zeros to yc if shorter as subtraction only
     * needs to start at yc.length.
     */
    if ((b = (j = yc.length) - (i = xc.length)) > 0)
        for (; b--;)
            xc[i++] = 0;
    // Subtract yc from xc.
    for (b = i; j > a;) {
        if (xc[--j] < yc[j]) {
            for (i = j; i && !xc[--i];)
                xc[i] = 9;
            --xc[i];
            xc[j] += 10;
        }
        xc[j] -= yc[j];
    }
    // Remove trailing zeros.
    for (; xc[--b] === 0;)
        xc.pop();
    // Remove leading zeros and adjust exponent accordingly.
    for (; xc[0] === 0;) {
        xc.shift();
        --ye;
    }
    if (!xc[0]) {
        // n - n = +0
        y.s = 1;
        // Result must be zero.
        xc = [ye = 0];
    }
    y.c = xc;
    y.e = ye;
    return y;
};
/*
 * Return a new Big whose value is the value of this Big modulo the value of Big y.
 */
P.mod = function (y) {
    var ygtx, Big = this.constructor, x = new Big(this), y = new Big(y), a = x.s, b = y.s;
    if (!y.c[0]) {
        throw Error(DIV_BY_ZERO);
    }
    x.s = y.s = 1;
    ygtx = y.cmp(x) == 1;
    x.s = a;
    y.s = b;
    if (ygtx)
        return new Big(x);
    a = Big.DP;
    b = Big.RM;
    Big.DP = Big.RM = 0;
    x = x.div(y);
    Big.DP = a;
    Big.RM = b;
    return this.minus(x.times(y));
};
/*
 * Return a new Big whose value is the value of this Big plus the value of Big y.
 */
P.plus = P.add = function (y) {
    var e, k, t, Big = this.constructor, x = new Big(this), y = new Big(y);
    // Signs differ?
    if (x.s != y.s) {
        y.s = -y.s;
        return x.minus(y);
    }
    var xe = x.e, xc = x.c, ye = y.e, yc = y.c;
    // Either zero?
    if (!xc[0] || !yc[0]) {
        if (!yc[0]) {
            if (xc[0]) {
                y = new Big(x);
            }
            else {
                y.s = x.s;
            }
        }
        return y;
    }
    xc = xc.slice();
    // Prepend zeros to equalise exponents.
    // Note: reverse faster than unshifts.
    if (e = xe - ye) {
        if (e > 0) {
            ye = xe;
            t = yc;
        }
        else {
            e = -e;
            t = xc;
        }
        t.reverse();
        for (; e--;)
            t.push(0);
        t.reverse();
    }
    // Point xc to the longer array.
    if (xc.length - yc.length < 0) {
        t = yc;
        yc = xc;
        xc = t;
    }
    e = yc.length;
    // Only start adding at yc.length - 1 as the further digits of xc can be left as they are.
    for (k = 0; e; xc[e] %= 10)
        k = (xc[--e] = xc[e] + yc[e] + k) / 10 | 0;
    // No need to check for zero, as +x + +y != 0 && -x + -y != 0
    if (k) {
        xc.unshift(k);
        ++ye;
    }
    // Remove trailing zeros.
    for (e = xc.length; xc[--e] === 0;)
        xc.pop();
    y.c = xc;
    y.e = ye;
    return y;
};
/*
 * Return a Big whose value is the value of this Big raised to the power n.
 * If n is negative, round to a maximum of Big.DP decimal places using rounding
 * mode Big.RM.
 *
 * n {number} Integer, -MAX_POWER to MAX_POWER inclusive.
 */
P.pow = function (n) {
    var Big = this.constructor, x = new Big(this), y = new Big('1'), one = new Big('1'), isneg = n < 0;
    if (n !== ~~n || n < -MAX_POWER || n > MAX_POWER) {
        throw Error(INVALID + 'exponent');
    }
    if (isneg)
        n = -n;
    for (;;) {
        if (n & 1)
            y = y.times(x);
        n >>= 1;
        if (!n)
            break;
        x = x.times(x);
    }
    return isneg ? one.div(y) : y;
};
/*
 * Return a new Big whose value is the value of this Big rounded to a maximum precision of sd
 * significant digits using rounding mode rm, or Big.RM if rm is not specified.
 *
 * sd {number} Significant digits: integer, 1 to MAX_DP inclusive.
 * rm? {number} Rounding mode: 0 (down), 1 (half-up), 2 (half-even) or 3 (up).
 */
P.prec = function (sd, rm) {
    if (sd !== ~~sd || sd < 1 || sd > MAX_DP) {
        throw Error(INVALID + 'precision');
    }
    return round(new this.constructor(this), sd, rm);
};
/*
 * Return a new Big whose value is the value of this Big rounded to a maximum of dp decimal places
 * using rounding mode rm, or Big.RM if rm is not specified.
 * If dp is negative, round to an integer which is a multiple of 10**-dp.
 * If dp is not specified, round to 0 decimal places.
 *
 * dp? {number} Integer, -MAX_DP to MAX_DP inclusive.
 * rm? {number} Rounding mode: 0 (down), 1 (half-up), 2 (half-even) or 3 (up).
 */
P.round = function (dp, rm) {
    if (dp === UNDEFINED)
        dp = 0;
    else if (dp !== ~~dp || dp < -MAX_DP || dp > MAX_DP) {
        throw Error(INVALID_DP);
    }
    return round(new this.constructor(this), dp + this.e + 1, rm);
};
/*
 * Return a new Big whose value is the square root of the value of this Big, rounded, if
 * necessary, to a maximum of Big.DP decimal places using rounding mode Big.RM.
 */
P.sqrt = function () {
    var r, c, t, Big = this.constructor, x = new Big(this), s = x.s, e = x.e, half = new Big('0.5');
    // Zero?
    if (!x.c[0])
        return new Big(x);
    // Negative?
    if (s < 0) {
        throw Error(NAME + 'No square root');
    }
    // Estimate.
    s = Math.sqrt(x + '');
    // Math.sqrt underflow/overflow?
    // Re-estimate: pass x coefficient to Math.sqrt as integer, then adjust the result exponent.
    if (s === 0 || s === 1 / 0) {
        c = x.c.join('');
        if (!(c.length + e & 1))
            c += '0';
        s = Math.sqrt(c);
        e = ((e + 1) / 2 | 0) - (e < 0 || e & 1);
        r = new Big((s == 1 / 0 ? '5e' : (s = s.toExponential()).slice(0, s.indexOf('e') + 1)) + e);
    }
    else {
        r = new Big(s + '');
    }
    e = r.e + (Big.DP += 4);
    // Newton-Raphson iteration.
    do {
        t = r;
        r = half.times(t.plus(x.div(t)));
    } while (t.c.slice(0, e).join('') !== r.c.slice(0, e).join(''));
    return round(r, (Big.DP -= 4) + r.e + 1, Big.RM);
};
/*
 * Return a new Big whose value is the value of this Big times the value of Big y.
 */
P.times = P.mul = function (y) {
    var c, Big = this.constructor, x = new Big(this), y = new Big(y), xc = x.c, yc = y.c, a = xc.length, b = yc.length, i = x.e, j = y.e;
    // Determine sign of result.
    y.s = x.s == y.s ? 1 : -1;
    // Return signed 0 if either 0.
    if (!xc[0] || !yc[0]) {
        y.c = [y.e = 0];
        return y;
    }
    // Initialise exponent of result as x.e + y.e.
    y.e = i + j;
    // If array xc has fewer digits than yc, swap xc and yc, and lengths.
    if (a < b) {
        c = xc;
        xc = yc;
        yc = c;
        j = a;
        a = b;
        b = j;
    }
    // Initialise coefficient array of result with zeros.
    for (c = new Array(j = a + b); j--;)
        c[j] = 0;
    // Multiply.
    // i is initially xc.length.
    for (i = b; i--;) {
        b = 0;
        // a is yc.length.
        for (j = a + i; j > i;) {
            // Current sum of products at this digit position, plus carry.
            b = c[j] + yc[i] * xc[j - i - 1] + b;
            c[j--] = b % 10;
            // carry
            b = b / 10 | 0;
        }
        c[j] = b;
    }
    // Increment result exponent if there is a final carry, otherwise remove leading zero.
    if (b)
        ++y.e;
    else
        c.shift();
    // Remove trailing zeros.
    for (i = c.length; !c[--i];)
        c.pop();
    y.c = c;
    return y;
};
/*
 * Return a string representing the value of this Big in exponential notation rounded to dp fixed
 * decimal places using rounding mode rm, or Big.RM if rm is not specified.
 *
 * dp? {number} Decimal places: integer, 0 to MAX_DP inclusive.
 * rm? {number} Rounding mode: 0 (down), 1 (half-up), 2 (half-even) or 3 (up).
 */
P.toExponential = function (dp, rm) {
    var x = this, n = x.c[0];
    if (dp !== UNDEFINED) {
        if (dp !== ~~dp || dp < 0 || dp > MAX_DP) {
            throw Error(INVALID_DP);
        }
        x = round(new x.constructor(x), ++dp, rm);
        for (; x.c.length < dp;)
            x.c.push(0);
    }
    return stringify(x, true, !!n);
};
/*
 * Return a string representing the value of this Big in normal notation rounded to dp fixed
 * decimal places using rounding mode rm, or Big.RM if rm is not specified.
 *
 * dp? {number} Decimal places: integer, 0 to MAX_DP inclusive.
 * rm? {number} Rounding mode: 0 (down), 1 (half-up), 2 (half-even) or 3 (up).
 *
 * (-0).toFixed(0) is '0', but (-0.1).toFixed(0) is '-0'.
 * (-0).toFixed(1) is '0.0', but (-0.01).toFixed(1) is '-0.0'.
 */
P.toFixed = function (dp, rm) {
    var x = this, n = x.c[0];
    if (dp !== UNDEFINED) {
        if (dp !== ~~dp || dp < 0 || dp > MAX_DP) {
            throw Error(INVALID_DP);
        }
        x = round(new x.constructor(x), dp + x.e + 1, rm);
        // x.e may have changed if the value is rounded up.
        for (dp = dp + x.e + 1; x.c.length < dp;)
            x.c.push(0);
    }
    return stringify(x, false, !!n);
};
/*
 * Return a string representing the value of this Big.
 * Return exponential notation if this Big has a positive exponent equal to or greater than
 * Big.PE, or a negative exponent equal to or less than Big.NE.
 * Omit the sign for negative zero.
 */
P.toJSON = P.toString = function () {
    var x = this, Big = x.constructor;
    return stringify(x, x.e <= Big.NE || x.e >= Big.PE, !!x.c[0]);
};
/*
 * Return the value of this Big as a primitve number.
 */
P.toNumber = function () {
    var n = Number(stringify(this, true, true));
    if (this.constructor.strict === true && !this.eq(n.toString())) {
        throw Error(NAME + 'Imprecise conversion');
    }
    return n;
};
/*
 * Return a string representing the value of this Big rounded to sd significant digits using
 * rounding mode rm, or Big.RM if rm is not specified.
 * Use exponential notation if sd is less than the number of digits necessary to represent
 * the integer part of the value in normal notation.
 *
 * sd {number} Significant digits: integer, 1 to MAX_DP inclusive.
 * rm? {number} Rounding mode: 0 (down), 1 (half-up), 2 (half-even) or 3 (up).
 */
P.toPrecision = function (sd, rm) {
    var x = this, Big = x.constructor, n = x.c[0];
    if (sd !== UNDEFINED) {
        if (sd !== ~~sd || sd < 1 || sd > MAX_DP) {
            throw Error(INVALID + 'precision');
        }
        x = round(new Big(x), sd, rm);
        for (; x.c.length < sd;)
            x.c.push(0);
    }
    return stringify(x, sd <= x.e || x.e <= Big.NE || x.e >= Big.PE, !!n);
};
/*
 * Return a string representing the value of this Big.
 * Return exponential notation if this Big has a positive exponent equal to or greater than
 * Big.PE, or a negative exponent equal to or less than Big.NE.
 * Include the sign for negative zero.
 */
P.valueOf = function () {
    var x = this, Big = x.constructor;
    if (Big.strict === true) {
        throw Error(NAME + 'valueOf disallowed');
    }
    return stringify(x, x.e <= Big.NE || x.e >= Big.PE, true);
};
// Export
/**
 * @type object
 */
var Big = _Big_();

const symbol = Symbol("numeric");
function isNumeric(x) {
    return typeof x === "number" || typeof x === "bigint" || x?.[symbol];
}
function isIntegral(x) {
    // Not perfect, because in JS we can't distinguish between 1.0 and 1
    return typeof x === "number" && Number.isInteger(x) || typeof x === "bigint";
}
function compare(x, y) {
    if (typeof x === "number") {
        return x < y ? -1 : (x > y ? 1 : 0);
    }
    else if (typeof x === "bigint") {
        return x < y ? -1 : (x > y ? 1 : 0);
    }
    else {
        return x.CompareTo(y);
    }
}
function multiply(x, y) {
    if (typeof x === "number") {
        return x * y;
    }
    else if (typeof x === "bigint") {
        return x * BigInt(y);
    }
    else {
        return x[symbol]().multiply(y);
    }
}
function toFixed(x, dp) {
    if (typeof x === "number") {
        return x.toFixed(dp);
    }
    else if (typeof x === "bigint") {
        return x.toString();
    }
    else {
        return x[symbol]().toFixed(dp);
    }
}
function toPrecision(x, sd) {
    if (typeof x === "number") {
        return x.toPrecision(sd);
    }
    else if (typeof x === "bigint") {
        return x.toString();
    }
    else {
        return x[symbol]().toPrecision(sd);
    }
}
function toExponential(x, dp) {
    if (typeof x === "number") {
        return x.toExponential(dp);
    }
    else if (typeof x === "bigint") {
        return x;
    }
    else {
        return x[symbol]().toExponential(dp);
    }
}
function toHex(x) {
    if (typeof x === "number") {
        return (Number(x) >>> 0).toString(16);
    }
    else if (typeof x === "bigint") {
        // TODO: properly handle other bit sizes
        return BigInt.asUintN(64, x).toString(16);
    }
    else {
        return x[symbol]().toHex();
    }
}

BigInt.prototype.toJSON = function () {
    return `${this.toString()}`;
};
function fromInt32(n) { return BigInt(n); }
function fromFloat64(n) { return BigInt(Math.trunc(n)); }
function fromString(s) { return BigInt(s); }
function toIntN_unchecked(bits, x, signed) {
    return signed ? BigInt.asIntN(bits, x) : BigInt.asUintN(bits, x);
}
function toInt64_unchecked(x) { return toIntN_unchecked(64, x, true); }

Big.prototype.GetHashCode = function () {
    return combineHashCodes([this.s, this.e].concat(this.c));
};
Big.prototype.Equals = function (x) {
    return !this.cmp(x);
};
Big.prototype.CompareTo = function (x) {
    return this.cmp(x);
};
Big.prototype[symbol] = function () {
    const _this = this;
    return {
        multiply: (y) => _this.mul(y),
        toPrecision: (sd) => _this.toPrecision(sd),
        toExponential: (dp) => _this.toExponential(dp),
        toFixed: (dp) => _this.toFixed(dp),
        toHex: () => (Number(_this) >>> 0).toString(16),
    };
};
new Big(0);
new Big(1);
new Big(-1);
new Big("79228162514264337593543950335");
new Big("-79228162514264337593543950335");
function toString$1(x) {
    return x.toString();
}
function tryParse$4(str, defValue) {
    try {
        defValue.contents = new Big(str.trim());
        return true;
    }
    catch {
        return false;
    }
}
// export function makeRangeStepFunction(step: Decimal, last: Decimal) {
//   const stepComparedWithZero = step.cmp(get_Zero);
//   if (stepComparedWithZero === 0) {
//     throw new Exception("The step of a range cannot be zero");
//   }
//   const stepGreaterThanZero = stepComparedWithZero > 0;
//   return (x: Decimal) => {
//     const comparedWithLast = x.cmp(last);
//     if ((stepGreaterThanZero && comparedWithLast <= 0)
//       || (!stepGreaterThanZero && comparedWithLast >= 0)) {
//       return [x, op_Addition(x, step)];
//     } else {
//       return undefined;
//     }
//   };
// }

// Using a class here for better compatibility with TS files importing Some
class Some {
    value;
    constructor(value) {
        this.value = value;
    }
    toJSON() {
        return this.value;
    }
    // Don't add "Some" for consistency with erased options
    toString() {
        return String(this.value);
    }
    GetHashCode() {
        return structuralHash(this.value);
    }
    Equals(other) {
        if (other == null) {
            return false;
        }
        else {
            return equals$1(this.value, other instanceof Some ? other.value : other);
        }
    }
    CompareTo(other) {
        if (other == null) {
            return 1;
        }
        else {
            return compare$1(this.value, other instanceof Some ? other.value : other);
        }
    }
}
function value(x) {
    if (x == null) {
        throw new Exception("Option has no value");
    }
    else {
        return x instanceof Some ? x.value : x;
    }
}
function some(x) {
    return x == null || x instanceof Some ? new Some(x) : x;
}

class CaseInfo {
    declaringType;
    tag;
    name;
    fields;
    constructor(declaringType, tag, name, fields) {
        this.declaringType = declaringType;
        this.tag = tag;
        this.name = name;
        this.fields = fields;
    }
}
class TypeInfo {
    fullname;
    generics;
    construct;
    parent;
    fields;
    cases;
    enumCases;
    constructor(fullname, generics, construct, parent, fields, cases, enumCases) {
        this.fullname = fullname;
        this.generics = generics;
        this.construct = construct;
        this.parent = parent;
        this.fields = fields;
        this.cases = cases;
        this.enumCases = enumCases;
    }
    toString() {
        return fullName(this);
    }
    GetHashCode() {
        return getHashCode(this);
    }
    Equals(other) {
        return equals(this, other);
    }
}
function getGenerics(t) {
    return t.generics != null ? t.generics : [];
}
function getHashCode(t) {
    const fullnameHash = stringHash(t.fullname);
    const genHashes = getGenerics(t).map(getHashCode);
    return combineHashCodes([fullnameHash, ...genHashes]);
}
function equals(t1, t2) {
    if (t1.fullname === "") { // Anonymous records
        return t2.fullname === ""
            && equalArraysWith(getRecordElements(t1), getRecordElements(t2), ([k1, v1], [k2, v2]) => k1 === k2 && equals(v1, v2));
    }
    else {
        return t1.fullname === t2.fullname
            && equalArraysWith(getGenerics(t1), getGenerics(t2), equals);
    }
}
function record_type(fullname, generics, construct, fields) {
    return new TypeInfo(fullname, generics, construct, undefined, fields);
}
function union_type(fullname, generics, construct, cases) {
    const t = new TypeInfo(fullname, generics, construct, undefined, undefined, () => {
        const caseNames = construct.prototype.cases();
        return cases().map((fields, i) => new CaseInfo(t, i, caseNames[i], fields));
    });
    return t;
}
function option_type(generic) {
    const t = new TypeInfo("Microsoft.FSharp.Core.FSharpOption`1", [generic], undefined, undefined, undefined, () => [
        new CaseInfo(t, 0, "None"),
        new CaseInfo(t, 1, "Some", [["value", generic]])
    ]);
    return t;
}
function list_type(generic) {
    const t = new TypeInfo("Microsoft.FSharp.Collections.FSharpList`1", [generic], undefined, undefined, undefined, () => [
        new CaseInfo(t, 0, "Empty"),
        new CaseInfo(t, 1, "Cons", [["Head", generic], ["Tail", t]])
    ]);
    return t;
}
const string_type = new TypeInfo("System.String");
function name(info) {
    if (Array.isArray(info)) {
        return info[0];
    }
    else if (info instanceof TypeInfo) {
        const elemType = getElementType(info);
        if (elemType != null) {
            return name(elemType) + "[]";
        }
        else {
            const i = info.fullname.lastIndexOf(".");
            return i === -1 ? info.fullname : info.fullname.slice(i + 1);
        }
    }
    else {
        return info.name;
    }
}
function fullName(t) {
    const elemType = getElementType(t);
    if (elemType != null) {
        return fullName(elemType) + "[]";
    }
    else if (t.generics == null || t.generics.length === 0) {
        return t.fullname;
    }
    else {
        return t.fullname + "[" + t.generics.map((x) => fullName(x)).join(",") + "]";
    }
}
function isArray(t) {
    return getElementType(t) != null;
}
function getElementType(t) {
    return t.fullname === "[]" && t.generics?.length === 1 ? t.generics[0] : undefined;
}
// FSharpType
function getUnionCases(t) {
    if (t.cases != null) {
        return t.cases();
    }
    else {
        throw new Exception(`${t.fullname} is not an F# union type`);
    }
}
function getRecordElements(t) {
    if (t.fields != null) {
        return t.fields();
    }
    else {
        throw new Exception(`${t.fullname} is not an F# record type`);
    }
}
function isUnion(t) {
    return t instanceof TypeInfo ? t.cases != null : t instanceof Union;
}
function isRecord(t) {
    return t instanceof TypeInfo ? t.fields != null : t instanceof Record;
}
// FSharpValue
function getUnionFields(v, t) {
    const cases = getUnionCases(t);
    // Special handling for option types (None is undefined, Some is the value or a Some wrapper)
    if (t.fullname === "Microsoft.FSharp.Core.FSharpOption`1") {
        if (v == null) {
            return [cases[0], []]; // None case
        }
        else {
            const innerValue = v instanceof Some ? v.value : v;
            return [cases[1], [innerValue]]; // Some case
        }
    }
    const case_ = cases[v.tag];
    if (case_ == null) {
        throw new Exception(`Cannot find case ${v.name} in union type`);
    }
    return [case_, v.fields];
}
function getUnionCaseFields(uci) {
    return uci.fields == null ? [] : uci.fields;
}
function getRecordField(v, field) {
    return v[field[0]];
}
function makeUnion(uci, values) {
    const expectedLength = (uci.fields || []).length;
    if (values.length !== expectedLength) {
        throw new Exception(`Expected an array of length ${expectedLength} but got ${values.length}`);
    }
    // Special handling for option types
    if (uci.declaringType.fullname === "Microsoft.FSharp.Core.FSharpOption`1") {
        return uci.tag === 0 ? undefined : some(values[0]);
    }
    const construct = uci.declaringType.construct;
    if (construct == null) {
        return {};
    }
    const isSingleCase = uci.declaringType.cases ? uci.declaringType.cases().length == 1 : false;
    if (isSingleCase) {
        return new construct(...values);
    }
    else {
        return new construct(uci.tag, values);
    }
}
function makeRecord(t, values) {
    const fields = getRecordElements(t);
    if (fields.length !== values.length) {
        throw new Exception(`Expected an array of length ${fields.length} but got ${values.length}`);
    }
    return t.construct != null
        ? new t.construct(...values)
        : fields.reduce((obj, [key, _t], i) => {
            obj[key] = values[i];
            return obj;
        }, {});
}

/**
 * DateTimeOffset functions.
 *
 * Note: Date instances are always DateObjects in local
 * timezone (because JS dates are all kinds of messed up).
 * A local date returns UTC epoch when `.getTime()` is called.
 *
 * Basically; invariant: date.getTime() always return UTC time.
 */
const shortDays = [
    "Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"
];
const longDays = [
    "Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"
];
const shortMonths = [
    "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"
];
const longMonths = [
    "January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"
];
function parseRepeatToken(format, pos, patternChar) {
    let tokenLength = 0;
    let internalPos = pos;
    while (internalPos < format.length && format[internalPos] === patternChar) {
        internalPos++;
        tokenLength++;
    }
    return tokenLength;
}
function parseNextChar(format, pos) {
    if (pos >= format.length - 1) {
        return -1;
    }
    return format.charCodeAt(pos + 1);
}
function parseQuotedString(format, pos) {
    let beginPos = pos;
    // Get the character used to quote the string
    const quoteChar = format[pos];
    let result = "";
    let foundQuote = false;
    while (pos < format.length) {
        pos++;
        const currentChar = format[pos];
        if (currentChar === quoteChar) {
            foundQuote = true;
            break;
        }
        else if (currentChar === "\\") {
            if (pos < format.length) {
                pos++;
                result += format[pos];
            }
            else {
                // This means that '\' is the last character in the string.
                throw new Exception("Invalid string format");
            }
        }
        else {
            result += currentChar;
        }
    }
    if (!foundQuote) {
        // We could not find the matching quote
        throw new Exception(`Invalid string format could not find matching quote for ${quoteChar}`);
    }
    return [result, pos - beginPos + 1];
}
function dateToStringWithCustomFormat(date, format, utc) {
    let cursorPos = 0;
    let tokenLength = 0;
    let result = "";
    const localizedDate = utc ? DateTime(date.getTime(), DateTimeKind.Utc) : date;
    while (cursorPos < format.length) {
        const token = format[cursorPos];
        switch (token) {
            case "d":
                tokenLength = parseRepeatToken(format, cursorPos, "d");
                cursorPos += tokenLength;
                switch (tokenLength) {
                    case 1:
                        result += day(localizedDate);
                        break;
                    case 2:
                        result += padWithZeros(day(localizedDate), 2);
                        break;
                    case 3:
                        result += shortDays[dayOfWeek(localizedDate)];
                        break;
                    case 4:
                    default:
                        result += longDays[dayOfWeek(localizedDate)];
                        break;
                }
                break;
            case "f":
                tokenLength = parseRepeatToken(format, cursorPos, "f");
                cursorPos += tokenLength;
                if (tokenLength <= 3) {
                    const precision = 10 ** (3 - tokenLength);
                    result += padWithZeros(Math.floor(millisecond(localizedDate) / precision), tokenLength);
                }
                else if (tokenLength <= 7) {
                    // JavaScript Date only support precision to the millisecond
                    // so we fill the rest of the precision with 0 as if the date didn't have
                    // milliseconds provided to it.
                    // This is to have the same behavior as .NET when doing:
                    // DateTime(1, 2, 3, 4, 5, 6, DateTimeKind.Utc).ToString("fffff") => 00000
                    result += ("" + millisecond(localizedDate)).padEnd(tokenLength, "0");
                }
                else {
                    throw "Input string was not in a correct format.";
                }
                break;
            case "F":
                tokenLength = parseRepeatToken(format, cursorPos, "F");
                cursorPos += tokenLength;
                if (tokenLength <= 3) {
                    const precision = 10 ** (3 - tokenLength);
                    const value = Math.floor(millisecond(localizedDate) / precision);
                    if (value != 0) {
                        result += padWithZeros(value, tokenLength);
                    }
                }
                else if (tokenLength <= 7) {
                    // JavaScript Date only support precision to the millisecond
                    // so we can't go beyond that.
                    // We also need to pad start with 0 if the value is not 0
                    const value = millisecond(localizedDate);
                    if (value != 0) {
                        result += padWithZeros(value, 3);
                    }
                }
                else {
                    throw "Input string was not in a correct format.";
                }
                break;
            case "g":
                tokenLength = parseRepeatToken(format, cursorPos, "g");
                cursorPos += tokenLength;
                result += "A.D.";
                break;
            case "h":
                tokenLength = parseRepeatToken(format, cursorPos, "h");
                cursorPos += tokenLength;
                switch (tokenLength) {
                    case 1:
                        const h1Value = hour(localizedDate) % 12;
                        result += h1Value ? h1Value : 12;
                        break;
                    case 2:
                    default:
                        const h2Value = hour(localizedDate) % 12;
                        result += padWithZeros(h2Value ? h2Value : 12, 2);
                        break;
                }
                break;
            case "H":
                tokenLength = parseRepeatToken(format, cursorPos, "H");
                cursorPos += tokenLength;
                switch (tokenLength) {
                    case 1:
                        result += hour(localizedDate);
                        break;
                    case 2:
                    default:
                        result += padWithZeros(hour(localizedDate), 2);
                        break;
                }
                break;
            case "K":
                tokenLength = parseRepeatToken(format, cursorPos, "K");
                cursorPos += tokenLength;
                switch (tokenLength) {
                    case 1:
                        switch (getKind(localizedDate)) {
                            case DateTimeKind.Utc:
                                result += "Z";
                                break;
                            case DateTimeKind.Local:
                                result += dateOffsetToString(localizedDate.getTimezoneOffset() * -6e4);
                                break;
                        }
                        break;
                }
                break;
            case "m":
                tokenLength = parseRepeatToken(format, cursorPos, "m");
                cursorPos += tokenLength;
                switch (tokenLength) {
                    case 1:
                        result += minute(localizedDate);
                        break;
                    case 2:
                    default:
                        result += padWithZeros(minute(localizedDate), 2);
                        break;
                }
                break;
            case "M":
                tokenLength = parseRepeatToken(format, cursorPos, "M");
                cursorPos += tokenLength;
                switch (tokenLength) {
                    case 1:
                        result += month(localizedDate);
                        break;
                    case 2:
                        result += padWithZeros(month(localizedDate), 2);
                        break;
                    case 3:
                        result += shortMonths[month(localizedDate) - 1];
                        break;
                    case 4:
                    default:
                        result += longMonths[month(localizedDate) - 1];
                        break;
                }
                break;
            case "s":
                tokenLength = parseRepeatToken(format, cursorPos, "s");
                cursorPos += tokenLength;
                switch (tokenLength) {
                    case 1:
                        result += second(localizedDate);
                        break;
                    case 2:
                    default:
                        result += padWithZeros(second(localizedDate), 2);
                        break;
                }
                break;
            case "t":
                tokenLength = parseRepeatToken(format, cursorPos, "t");
                cursorPos += tokenLength;
                switch (tokenLength) {
                    case 1:
                        result += localizedDate.getHours() < 12 ? "A" : "P";
                        break;
                    case 2:
                    default:
                        result += localizedDate.getHours() < 12 ? "AM" : "PM";
                        break;
                }
                break;
            case "y":
                tokenLength = parseRepeatToken(format, cursorPos, "y");
                cursorPos += tokenLength;
                switch (tokenLength) {
                    case 1:
                        result += year(localizedDate) % 100;
                        break;
                    case 2:
                        result += padWithZeros(year(localizedDate) % 100, 2);
                        break;
                    default:
                        result += padWithZeros(year(localizedDate), tokenLength);
                        break;
                }
                break;
            case "z":
                tokenLength = parseRepeatToken(format, cursorPos, "z");
                cursorPos += tokenLength;
                let utcOffsetText = "";
                switch (getKind(localizedDate)) {
                    case DateTimeKind.Utc:
                        utcOffsetText = "+00:00";
                        break;
                    case DateTimeKind.Local:
                        utcOffsetText = dateOffsetToString(localizedDate.getTimezoneOffset() * -6e4);
                        break;
                    case DateTimeKind.Unspecified:
                        utcOffsetText = dateOffsetToString(toLocalTime(localizedDate).getTimezoneOffset() * -6e4);
                        break;
                }
                const sign = utcOffsetText[0] === "-" ? "-" : "+";
                const hours = parseInt(utcOffsetText.substring(1, 3), 10);
                const minutes = parseInt(utcOffsetText.substring(4, 6), 10);
                switch (tokenLength) {
                    case 1:
                        result += `${sign}${hours}`;
                        break;
                    case 2:
                        result += `${sign}${padWithZeros(hours, 2)}`;
                        break;
                    default:
                        result += `${sign}${padWithZeros(hours, 2)}:${padWithZeros(minutes, 2)}`;
                        break;
                }
                break;
            case ":":
                result += ":";
                cursorPos++;
                break;
            case "/":
                result += "/";
                cursorPos++;
                break;
            case "'":
            case '"':
                const [quotedString, quotedStringLenght] = parseQuotedString(format, cursorPos);
                result += quotedString;
                cursorPos += quotedStringLenght;
                break;
            case "%":
                const nextChar = parseNextChar(format, cursorPos);
                if (nextChar >= 0 && nextChar !== "%".charCodeAt(0)) {
                    cursorPos += 2;
                    result += dateToStringWithCustomFormat(localizedDate, String.fromCharCode(nextChar), utc);
                }
                else {
                    throw new Exception("Invalid format string");
                }
                break;
            case "\\":
                const nextChar2 = parseNextChar(format, cursorPos);
                if (nextChar2 >= 0) {
                    cursorPos += 2;
                    result += String.fromCharCode(nextChar2);
                }
                else {
                    throw new Exception("Invalid format string");
                }
                break;
            default:
                cursorPos++;
                result += token;
                break;
        }
    }
    return result;
}
function getKind(value) {
    return value.kind ?? DateTimeKind.Unspecified;
}
function dateOffsetToString(offset) {
    const isMinus = offset < 0;
    offset = Math.abs(offset);
    const hours = ~~(offset / 3600000);
    const minutes = (offset % 3600000) / 60_000;
    return (isMinus ? "-" : "+") +
        padWithZeros(hours, 2) + ":" +
        padWithZeros(minutes, 2);
}
function dateToISOString(d, utc) {
    if (utc) {
        return d.toISOString();
    }
    else {
        // JS Date is always local
        const printOffset = d.kind == null ? true : d.kind === DateTimeKind.Local;
        return padWithZeros(d.getFullYear(), 4) + "-" +
            padWithZeros(d.getMonth() + 1, 2) + "-" +
            padWithZeros(d.getDate(), 2) + "T" +
            padWithZeros(d.getHours(), 2) + ":" +
            padWithZeros(d.getMinutes(), 2) + ":" +
            padWithZeros(d.getSeconds(), 2) + "." +
            padWithZeros(d.getMilliseconds(), 3) +
            (printOffset ? dateOffsetToString(d.getTimezoneOffset() * -6e4) : "");
    }
}
function dateToISOStringWithOffset(dateWithOffset, offset) {
    const str = dateWithOffset.toISOString();
    return str.substring(0, str.length - 1) + dateOffsetToString(offset);
}
function dateToStringWithOffset(date, format) {
    const d = new Date(date.getTime() + (date.offset ?? 0));
    if (typeof format !== "string") {
        return d.toISOString().replace(/\.\d+/, "").replace(/[A-Z]|\.\d+/g, " ") + dateOffsetToString((date.offset ?? 0));
    }
    else if (format.length === 1) {
        switch (format) {
            case "D": return dateToString_D(d);
            case "d": return dateToString_d(d);
            case "F": return dateToString_D(d) + " " + dateToString_T(d);
            case "f": return dateToString_D(d) + " " + dateToString_t(d);
            case "G": return dateToString_d(d) + " " + dateToString_T(d);
            case "g": return dateToString_d(d) + " " + dateToString_t(d);
            case "M":
            case "m": return dateToString_M(d);
            case "O":
            case "o": return dateToISOStringWithOffset(d, (date.offset ?? 0));
            case "R":
            case "r": {
                const utcDate = DateTime(date.getTime(), DateTimeKind.Utc);
                return dateToString_R(utcDate);
            }
            case "s": return dateToString_s(toUniversalTime$1(d));
            case "T": return dateToString_T(toUniversalTime$1(d));
            case "t": return dateToString_t(toUniversalTime$1(d));
            case "u": {
                const utcDate = DateTime(date.getTime(), DateTimeKind.Utc);
                return dateToString_u(utcDate);
            }
            case "U": {
                const utcDate = DateTime(date.getTime(), DateTimeKind.Utc);
                return dateToString_D(utcDate) + " " + dateToString_T(utcDate);
            }
            case "Y":
            case "y": return dateToString_Y(d);
            default: throw new Exception("Unrecognized Date print format");
        }
    }
    else {
        return dateToStringWithCustomFormat(d, format, true);
    }
}
function dateToString_D(date) {
    return longDays[dayOfWeek(date)]
        + ", " + padWithZeros(day(date), 2)
        + " " + longMonths[month(date) - 1]
        + " " + year(date);
}
function dateToString_d(date) {
    return padWithZeros(month(date), 2)
        + "/" + padWithZeros(day(date), 2)
        + "/" + year(date);
}
function dateToString_T(date) {
    return padWithZeros(hour(date), 2)
        + ":" + padWithZeros(minute(date), 2)
        + ":" + padWithZeros(second(date), 2);
}
function dateToString_t(date) {
    return padWithZeros(hour(date), 2)
        + ":" + padWithZeros(minute(date), 2);
}
// RFC 1123: "Thu, 01 Jan 2009 00:00:00 GMT" — always UTC
function dateToString_R(date) {
    const utcDate = toUniversalTime$1(date);
    return shortDays[dayOfWeek(utcDate)] + ", "
        + padWithZeros(day(utcDate), 2) + " "
        + shortMonths[month(utcDate) - 1] + " "
        + year(utcDate) + " "
        + padWithZeros(hour(utcDate), 2) + ":"
        + padWithZeros(minute(utcDate), 2) + ":"
        + padWithZeros(second(utcDate), 2) + " GMT";
}
// Sortable ISO 8601, no timezone: "2009-06-15T13:45:30"
function dateToString_s(date) {
    return padWithZeros(year(date), 4) + "-"
        + padWithZeros(month(date), 2) + "-"
        + padWithZeros(day(date), 2) + "T"
        + padWithZeros(hour(date), 2) + ":"
        + padWithZeros(minute(date), 2) + ":"
        + padWithZeros(second(date), 2);
}
// Universal sortable: "2009-06-15 13:45:30Z" — always UTC
function dateToString_u(date) {
    const utcDate = toUniversalTime$1(date);
    return padWithZeros(year(utcDate), 4) + "-"
        + padWithZeros(month(utcDate), 2) + "-"
        + padWithZeros(day(utcDate), 2) + " "
        + padWithZeros(hour(utcDate), 2) + ":"
        + padWithZeros(minute(utcDate), 2) + ":"
        + padWithZeros(second(utcDate), 2) + "Z";
}
// Month/day (InvariantCulture "MMMM dd"): "June 15"
function dateToString_M(date) {
    return longMonths[month(date) - 1] + " " + padWithZeros(day(date), 2);
}
// Year/month (InvariantCulture "yyyy MMMM"): "2009 June"
function dateToString_Y(date) {
    return year(date) + " " + longMonths[month(date) - 1];
}
function dateToStringWithKind(date, format) {
    const utc = date.kind === DateTimeKind.Utc;
    if (typeof format !== "string") {
        return dateToString_d(date) + " " + dateToString_T(date);
    }
    else if (format.length === 1) {
        switch (format) {
            case "D": return dateToString_D(date);
            case "d": return dateToString_d(date);
            case "F": return dateToString_D(date) + " " + dateToString_T(date);
            case "f": return dateToString_D(date) + " " + dateToString_t(date);
            case "G": return dateToString_d(date) + " " + dateToString_T(date);
            case "g": return dateToString_d(date) + " " + dateToString_t(date);
            case "M":
            case "m": return dateToString_M(date);
            case "O":
            case "o": return dateToISOString(date, utc);
            case "R":
            case "r": return dateToString_R(date);
            case "s": return dateToString_s(date);
            case "T": return dateToString_T(date);
            case "t": return dateToString_t(date);
            case "u": return dateToString_u(date);
            case "U": return dateToString_D(toUniversalTime$1(date)) + " " + dateToString_T(toUniversalTime$1(date));
            case "Y":
            case "y": return dateToString_Y(date);
            default:
                throw new Exception("Unrecognized Date print format");
        }
    }
    else {
        return dateToStringWithCustomFormat(date, format, utc);
    }
}
function toString(date, format, _provider) {
    return date.offset != null
        ? dateToStringWithOffset(date, format)
        : dateToStringWithKind(date, format);
}
function DateTime(value, kind) {
    const d = new Date(value);
    d.kind = (kind == null ? DateTimeKind.Unspecified : kind);
    return d;
}
function minValue() {
    // This is "0001-01-01T00:00:00.000Z", actual JS min value is -8640000000000000
    return DateTime(-621355968e5, DateTimeKind.Utc);
}
// The only date words .NET's invariant parser recognises: month names, weekday names,
// meridiem designators and zone markers (plus the ISO "T" separator). Anything else is
// rejected. Used to reject JS-permissive inputs (see `parseRaw`).
const recognizedDateWords = new Set([
    "january", "february", "march", "april", "may", "june",
    "july", "august", "september", "october", "november", "december",
    "jan", "feb", "mar", "apr", "jun", "jul", "aug", "sep", "sept", "oct", "nov", "dec",
    "monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday",
    "mon", "tue", "wed", "thu", "fri", "sat", "sun",
    "am", "pm", "gmt", "utc", "ut", "t", "z",
]);
function parseRaw(input) {
    function fail() {
        throw new Exception(`The string is not a valid Date: ${input}`);
    }
    if (input == null || input.trim() === "") {
        fail();
    }
    if ((input.match(/[a-z]+/gi) ?? []).some(word => !recognizedDateWords.has(word.toLowerCase()))) {
        fail();
    }
    // ISO dates without TZ are parsed as UTC. Adding time without TZ keeps them local.
    if (input.length === 10 && input[4] === "-" && input[7] === "-") {
        input += "T00:00:00";
    }
    let date = new Date(input);
    let offset = null;
    if (isNaN(date.getTime())) {
        // Try to check strings JS Date cannot parse (see #1045, #1422)
        const m = /^\s*(\d+[^\w\s:]\d+[^\w\s:]\d+)?\s*(\d+:\d+(?::\d+(?:\.\d+)?)?)?\s*([AaPp][Mm])?\s*(Z|[+-]([01]?\d):?([0-5]?\d)?)?\s*$/.exec(input);
        if (m != null) {
            let baseDate;
            let timeInSeconds = 0;
            if (m[2] != null) {
                const timeParts = m[2].split(":");
                const hourPart = parseInt(timeParts[0], 10);
                timeInSeconds =
                    hourPart * 3600 +
                        parseInt(timeParts[1] || "0", 10) * 60 +
                        parseFloat(timeParts[2] || "0");
                if (m[3] != null && m[3].toUpperCase() === "PM" && hourPart < 12) {
                    timeInSeconds += 12 * 3600;
                }
                else if (m[3] != null && m[3].toUpperCase() === "AM" && hourPart === 12) {
                    timeInSeconds -= 12 * 3600;
                }
            }
            if (m[4] != null) { // There's an offset, parse as UTC
                if (m[1] != null) {
                    baseDate = new Date(m[1] + " UTC");
                }
                else {
                    const d = new Date();
                    baseDate = new Date(d.getUTCFullYear() + "/" + (d.getUTCMonth() + 1) + "/" + d.getUTCDate());
                }
                if (m[4] === "Z") {
                    offset = "Z";
                }
                else {
                    let offsetInMinutes = parseInt(m[5], 10) * 60 + parseInt(m[6] || "0", 10);
                    if (m[4][0] === "-") {
                        offsetInMinutes *= -1;
                    }
                    offset = offsetInMinutes;
                    timeInSeconds -= offsetInMinutes * 60;
                }
            }
            else {
                if (m[1] != null) {
                    baseDate = new Date(m[1]);
                }
                else {
                    const d = new Date();
                    baseDate = new Date(d.getFullYear() + "/" + (d.getMonth() + 1) + "/" + d.getDate());
                }
            }
            date = new Date(baseDate.getTime() + timeInSeconds * 1000);
            // correct for daylight savings time
            date = new Date(date.getTime() + (date.getTimezoneOffset() - baseDate.getTimezoneOffset()) * 60_000);
        }
        else {
            fail();
        }
        // Check again the date is valid after transformations, see #2229
        if (isNaN(date.getTime())) {
            fail();
        }
    }
    return [date, offset];
}
function parse$3(str, detectUTC = false) {
    const [date, offset] = parseRaw(str);
    // .NET always parses DateTime as Local if there's offset info (even "Z")
    // Newtonsoft.Json uses UTC if the offset is "Z"
    const kind = offset != null
        ? (detectUTC && offset === "Z" ? DateTimeKind.Utc : DateTimeKind.Local)
        : DateTimeKind.Unspecified;
    return DateTime(date.getTime(), kind);
}
function tryParse$3(v, defValue) {
    try {
        defValue.contents = parse$3(v);
        return true;
    }
    catch (_err) {
        return false;
    }
}
function create(year, month, day, h = 0, m = 0, s = 0, ms = 0, kind) {
    const date = new Date(Date.UTC(year, month - 1, day, h, m, s, ms))
        ;
    if (year <= 99) {
        {
            date.setUTCFullYear(year, month - 1, day);
        }
    }
    const dateValue = date.getTime();
    if (isNaN(dateValue)) {
        throw new Exception("The parameters describe an unrepresentable Date.");
    }
    return DateTime(dateValue, kind);
}
function toUniversalTime$1(date) {
    return date.kind === DateTimeKind.Utc ? date : DateTime(date.getTime(), DateTimeKind.Utc);
}
function toLocalTime(date) {
    return date.kind === DateTimeKind.Local ? date : DateTime(date.getTime(), DateTimeKind.Local);
}
function specifyKind(d, kind) {
    return create(year(d), month(d), day(d), hour(d), minute(d), second(d), millisecond(d), kind);
}
function day(d) {
    return d.kind === DateTimeKind.Utc ? d.getUTCDate() : d.getDate();
}
function hour(d) {
    return d.kind === DateTimeKind.Utc ? d.getUTCHours() : d.getHours();
}
function millisecond(d) {
    return d.kind === DateTimeKind.Utc ? d.getUTCMilliseconds() : d.getMilliseconds();
}
function minute(d) {
    return d.kind === DateTimeKind.Utc ? d.getUTCMinutes() : d.getMinutes();
}
function month(d) {
    return (d.kind === DateTimeKind.Utc ? d.getUTCMonth() : d.getMonth()) + 1;
}
function second(d) {
    return d.kind === DateTimeKind.Utc ? d.getUTCSeconds() : d.getSeconds();
}
function year(d) {
    return d.kind === DateTimeKind.Utc ? d.getUTCFullYear() : d.getFullYear();
}
function dayOfWeek(d) {
    return d.kind === DateTimeKind.Utc ? d.getUTCDay() : d.getDay();
}
function add$1(d, ts) {
    const newDate = DateTime(d.getTime() + ts, d.kind);
    if (d.kind !== DateTimeKind.Utc) {
        const oldTzOffset = d.getTimezoneOffset();
        const newTzOffset = newDate.getTimezoneOffset();
        return oldTzOffset !== newTzOffset
            ? DateTime(newDate.getTime() + (newTzOffset - oldTzOffset) * 60_000, d.kind)
            : newDate;
    }
    else {
        return newDate;
    }
}
function addMinutes(d, v) {
    return add$1(d, v * 60_000);
}

// From http://stackoverflow.com/questions/3446170/escape-string-for-use-in-javascript-regex
function escape(str) {
    // Matches the characters escaped by .NET's Regex.Escape.
    // Note:
    //
    //  .NET also escapes space and # (relevant for IgnorePatternWhitespace mode),
    //  but JS unicode-mode regex rejects \  and \# as invalid escapes, and we don't
    //  support IgnorePatternWhitespace, so we omit them.
    //
    //  .NET does not escape ] and } but JS unicode-mode regex rejects bare ] and }
    //  as invalid, so we escape them too for compatibility.
    return str.replace(/[$()*+.?[\\\^{|}\]]/g, "\\$&");
}
function match(reg, input, startAt = 0) {
    reg.lastIndex = startAt;
    return reg.exec(input);
}

const fsFormatRegExp = /(^|[^%])%([0+\- ]*)(\*|\d+)?(?:\.(\d+))?(\w)/g;
const formatRegExp = /\{(\d+)(,-?\d+)?(?:\:([a-zA-Z])(\d{0,2})|\:(.+?))?\}/g;
function isLessThan(x, y) {
    return compare(x, y) < 0;
}
function cmp(x, y, ic) {
    if (x == null) {
        return y == null ? 0 : -1;
    }
    if (y == null) {
        return 1;
    } // everything is bigger than null
    {
        {
            x = x.toLowerCase();
            y = y.toLowerCase();
        }
        return (x === y) ? 0 : (x < y ? -1 : 1);
    }
}
function startsWith(str, pattern, ic) {
    if (str.length >= pattern.length) {
        return cmp(str.slice(0, pattern.length), pattern) === 0;
    }
    return false;
}
function indexOf(str, searchValue, comparison, startIndex = 0) {
    { // fast path
        return str.indexOf(searchValue, startIndex);
    }
}
function printf(input) {
    return {
        input,
        cont: fsFormat(input),
    };
}
function continuePrint(cont, arg) {
    return typeof arg === "string" ? cont(arg) : arg.cont(cont);
}
function toText(arg) {
    return continuePrint((x) => x, arg);
}
function toFail(arg) {
    return continuePrint((x) => {
        throw new Exception(x);
    }, arg);
}
function formatReplacement(rep, flags, padLength, precision, format) {
    let sign = "";
    flags = flags || "";
    format = format || "";
    if (isNumeric(rep)) {
        if (format.toLowerCase() !== "x") {
            if (isLessThan(rep, 0)) {
                rep = multiply(rep, -1);
                sign = "-";
            }
            else {
                if (flags.indexOf(" ") >= 0) {
                    sign = " ";
                }
                else if (flags.indexOf("+") >= 0) {
                    sign = "+";
                }
            }
        }
        precision = precision == null ? null : parseInt(precision, 10);
        switch (format) {
            case "f":
            case "F":
                precision = precision != null ? precision : 6;
                rep = toFixed(rep, precision);
                break;
            case "g":
            case "G":
                rep = precision != null ? toPrecision(rep, precision) : toPrecision(rep);
                break;
            case "e":
            case "E":
                rep = precision != null ? toExponential(rep, precision) : toExponential(rep);
                break;
            case "x":
                rep = toHex(rep);
                break;
            case "X":
                rep = toHex(rep).toUpperCase();
                break;
            default: // AOid
                rep = String(rep);
                break;
        }
    }
    else if (rep instanceof Date) {
        rep = toString(rep);
    }
    else if (format === "A" && typeof rep === "string") {
        rep = "\"" + rep + "\"";
    }
    else {
        rep = toString$2(rep);
    }
    padLength = typeof padLength === "number" ? padLength : parseInt(padLength, 10);
    if (!isNaN(padLength)) {
        const zeroFlag = flags.indexOf("0") >= 0; // Use '0' for left padding
        const minusFlag = flags.indexOf("-") >= 0; // Right padding
        const ch = minusFlag || !zeroFlag ? " " : "0";
        if (ch === "0") {
            rep = pad(rep, padLength - sign.length, ch, minusFlag);
            rep = sign + rep;
        }
        else {
            rep = pad(sign + rep, padLength, ch, minusFlag);
        }
    }
    else {
        rep = sign + rep;
    }
    return rep;
}
function createPrinter(cont, _strParts, _matches, _result = "", padArg = -1) {
    return (...args) => {
        // Make copies of the values passed by reference because the function can be used multiple times
        let result = _result;
        const strParts = _strParts.slice();
        const matches = _matches.slice();
        for (const arg of args) {
            const [, , flags, _padLength, precision, format] = matches[0];
            let padLength = _padLength;
            if (padArg >= 0) {
                padLength = padArg;
                padArg = -1;
            }
            else if (padLength === "*") {
                if (arg < 0) {
                    throw new Exception("Non-negative number required");
                }
                padArg = arg;
                continue;
            }
            result += strParts[0];
            result += formatReplacement(arg, flags, padLength, precision, format);
            strParts.splice(0, 1);
            matches.splice(0, 1);
        }
        if (matches.length === 0) {
            result += strParts[0];
            return cont(result);
        }
        else {
            return createPrinter(cont, strParts, matches, result, padArg);
        }
    };
}
function fsFormat(str) {
    return (cont) => {
        fsFormatRegExp.lastIndex = 0;
        const strParts = [];
        const matches = [];
        let strIdx = 0;
        let match = fsFormatRegExp.exec(str);
        while (match) {
            // The first group corresponds to the no-escape char (^|[^%]), the actual pattern starts in the next char
            // Note: we don't use negative lookbehind because some browsers don't support it yet
            const matchIndex = match.index + (match[1] || "").length;
            strParts.push(str.substring(strIdx, matchIndex).replace(/%%/g, "%"));
            matches.push(match);
            strIdx = fsFormatRegExp.lastIndex;
            // Likewise we need to move fsFormatRegExp.lastIndex one char behind to make sure we match the no-escape char next time
            fsFormatRegExp.lastIndex -= 1;
            match = fsFormatRegExp.exec(str);
        }
        if (strParts.length === 0) {
            return cont(str.replace(/%%/g, "%"));
        }
        else {
            strParts.push(str.substring(strIdx).replace(/%%/g, "%"));
            return createPrinter(cont, strParts, matches);
        }
    };
}
function splitIntAndDecimalPart(value) {
    let [repInt, repDecimal] = value.split(".");
    repDecimal === undefined && (repDecimal = "");
    return {
        integral: repInt,
        decimal: repDecimal
    };
}
function thousandSeparate(value) {
    return value.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}
function format(str, ...args) {
    let str2;
    {
        str2 = str;
    }
    return str2.replace(formatRegExp, (_, idx, padLength, format, precision, pattern) => {
        if (idx < 0 || idx >= args.length) {
            throw new Exception("Index must be greater or equal to zero and less than the arguments' length.");
        }
        let rep = args[idx];
        let parts;
        if (isNumeric(rep)) {
            precision = precision == "" ? null : parseInt(precision, 10);
            switch (format) {
                case "b":
                case "B":
                    if (!isIntegral(rep)) {
                        throw new Exception("Format specifier was invalid.");
                    }
                    rep = (rep >>> 0).toString(2).replace(/^0+/, "").padStart(precision || 1, "0");
                    break;
                case "c":
                case "C":
                    const isNegative = isLessThan(rep, 0);
                    if (isLessThan(rep, 0)) {
                        rep = multiply(rep, -1);
                    }
                    precision = precision == null ? 2 : precision;
                    rep = toFixed(rep, precision);
                    parts = splitIntAndDecimalPart(rep);
                    if (precision > 0) {
                        rep = "¤" + thousandSeparate(parts.integral) + "." + padRight(parts.decimal, precision, "0");
                    }
                    else {
                        rep = "¤" + thousandSeparate(parts.integral);
                    }
                    if (isNegative) {
                        rep = "(" + rep + ")";
                    }
                    break;
                case "d":
                case "D":
                    if (!isIntegral(rep)) {
                        throw new Exception("Format specifier was invalid.");
                    }
                    rep = String(rep);
                    if (precision != null) {
                        if (rep.startsWith("-")) {
                            rep = "-" + padLeft(rep.substring(1), precision, "0");
                        }
                        else {
                            rep = padLeft(rep, precision, "0");
                        }
                    }
                    break;
                case "e":
                case "E":
                    rep = precision != null ? toExponential(rep, precision) : toExponential(rep);
                    break;
                case "f":
                case "F":
                    precision = precision != null ? precision : 2;
                    rep = toFixed(rep, precision);
                    if (precision > 0) {
                        parts = splitIntAndDecimalPart(rep);
                        rep = parts.integral + "." + padRight(parts.decimal, precision, "0");
                    }
                    break;
                case "g":
                case "G": {
                    rep = precision != null ? toPrecision(rep, precision) : toPrecision(rep);
                    // Handle exponential notation: only trim trailing zeros from mantissa, not from exponent.
                    // .NET G format guarantees an exponent of at least 2 digits with an explicit sign (e.g. "E-07").
                    const eIdx = rep.indexOf("e");
                    if (eIdx >= 0) {
                        const mantissa = trimEnd(trimEnd(rep.slice(0, eIdx), "0"), ".");
                        const expSign = rep[eIdx + 1]; // toPrecision always emits "+" or "-"
                        const expDigits = rep.slice(eIdx + 2);
                        const paddedExpDigits = expDigits.length < 2 ? "0" + expDigits : expDigits;
                        const eChar = format === "G" ? "E" : "e";
                        rep = mantissa + eChar + expSign + paddedExpDigits;
                    }
                    else {
                        rep = trimEnd(trimEnd(rep, "0"), ".");
                    }
                    break;
                }
                case "n":
                case "N":
                    precision = precision != null ? precision : 2;
                    rep = toFixed(rep, precision);
                    parts = splitIntAndDecimalPart(rep);
                    if (precision > 0) {
                        rep = thousandSeparate(parts.integral) + "." + padRight(parts.decimal, precision, "0");
                    }
                    else {
                        rep = thousandSeparate(parts.integral);
                    }
                    break;
                case "p":
                case "P":
                    precision = precision != null ? precision : 2;
                    rep = toFixed(multiply(rep, 100), precision);
                    parts = splitIntAndDecimalPart(rep);
                    if (precision > 0) {
                        rep = thousandSeparate(parts.integral) + "." + padRight(parts.decimal, precision, "0") + " %";
                    }
                    else {
                        rep = thousandSeparate(parts.integral) + " %";
                    }
                    break;
                case "r":
                case "R":
                    throw new Exception("The round-trip format is not supported by Fable");
                case "x":
                case "X":
                    if (!isIntegral(rep)) {
                        throw new Exception("Format specifier was invalid.");
                    }
                    precision = precision != null ? precision : 1;
                    rep = padLeft(toHex(rep), precision, "0");
                    if (format === "X") {
                        rep = rep.toUpperCase();
                    }
                    break;
                default:
                    // If we have format and were not able to handle it throw
                    // See: https://learn.microsoft.com/en-us/dotnet/standard/base-types/standard-numeric-format-strings#standard-format-specifiers
                    if (format) {
                        throw new Exception("Format specifier was invalid.");
                    }
                    if (pattern) {
                        let sign = "";
                        rep = pattern.replace(/([0#,]+)(\.[0#]+)?/, (_, intPart, decimalPart) => {
                            if (isLessThan(rep, 0)) {
                                rep = multiply(rep, -1);
                                sign = "-";
                            }
                            decimalPart = decimalPart == null ? "" : decimalPart.substring(1);
                            rep = toFixed(rep, Math.max(decimalPart.length, 0));
                            let [repInt, repDecimal] = rep.split(".");
                            repDecimal ||= "";
                            const leftZeroes = intPart.replace(/,/g, "").replace(/^#+/, "").length;
                            repInt = padLeft(repInt, leftZeroes, "0");
                            const rightZeros = decimalPart.replace(/#+$/, "").length;
                            if (rightZeros > repDecimal.length) {
                                repDecimal = padRight(repDecimal, rightZeros, "0");
                            }
                            else if (rightZeros < repDecimal.length) {
                                repDecimal = repDecimal.substring(0, rightZeros) + repDecimal.substring(rightZeros).replace(/0+$/, "");
                            }
                            // Thousands separator
                            if (intPart.indexOf(",") > 0) {
                                const i = repInt.length % 3;
                                const thousandGroups = Math.floor(repInt.length / 3);
                                let thousands = i > 0 ? repInt.substr(0, i) + (thousandGroups > 0 ? "," : "") : "";
                                for (let j = 0; j < thousandGroups; j++) {
                                    thousands += repInt.substr(i + j * 3, 3) + (j < thousandGroups - 1 ? "," : "");
                                }
                                repInt = thousands;
                            }
                            return repDecimal.length > 0 ? repInt + "." + repDecimal : repInt;
                        });
                        rep = sign + rep;
                    }
            }
        }
        else if (rep instanceof Date) {
            rep = toString(rep, pattern || format);
        }
        else {
            rep = toString$2(rep);
        }
        padLength = parseInt((padLength || " ").substring(1), 10);
        if (!isNaN(padLength)) {
            rep = pad(String(rep), Math.abs(padLength), " ", padLength < 0);
        }
        return rep;
    });
}
function isNullOrEmpty(str) {
    return typeof str !== "string" || str.length === 0;
}
function isNullOrWhiteSpace(str) {
    return typeof str !== "string" || /^\s*$/.test(str);
}
function concat$1(...xs) {
    return xs.map((x) => String(x)).join("");
}
function join(delimiter, xs) {
    if (Array.isArray(xs)) {
        return xs.join(delimiter);
    }
    else {
        return Array.from(xs).join(delimiter);
    }
}
function pad(str, len, ch, isRight) {
    ch = ch || " ";
    len = len - str.length;
    for (let i = 0; i < len; i++) {
        str = isRight ? str + ch : ch + str;
    }
    return str;
}
function padLeft(str, len, ch) {
    return pad(str, len, ch);
}
function padRight(str, len, ch) {
    return pad(str, len, ch, true);
}
function replace(str, search, replace) {
    return str.replace(new RegExp(escape(search), "g"), replace);
}
function split(str, splitters, count, options) {
    count = typeof count === "number" ? count : undefined;
    options = typeof options === "number" ? options : 0;
    if (count && count < 0) {
        throw new Exception("Count cannot be less than zero");
    }
    if (count === 0) {
        return [];
    }
    const removeEmpty = (options & 1) === 1;
    const trim = (options & 2) === 2;
    splitters = splitters || [];
    splitters = splitters.filter(x => x).map(escape);
    splitters = splitters.length > 0 ? splitters : ["\\s"];
    const splits = [];
    const reg = new RegExp(splitters.join("|"), "g");
    let findSplits = true;
    let i = 0;
    do {
        const match = reg.exec(str);
        if (match === null) {
            const candidate = trim ? str.substring(i).trim() : str.substring(i);
            if (!removeEmpty || candidate.length > 0) {
                splits.push(candidate);
            }
            findSplits = false;
        }
        else {
            const candidate = trim ? str.substring(i, match.index).trim() : str.substring(i, match.index);
            if (!removeEmpty || candidate.length > 0) {
                if (count != null && splits.length + 1 === count) {
                    splits.push(trim ? str.substring(i).trim() : str.substring(i));
                    findSplits = false;
                }
                else {
                    splits.push(candidate);
                }
            }
            i = reg.lastIndex;
        }
    } while (findSplits);
    return splits;
}
function trim(str, ...chars) {
    if (chars.length === 0) {
        return str.trim();
    }
    const pattern = "[" + escape(chars.join("")) + "]+";
    return str.replace(new RegExp("^" + pattern), "").replace(new RegExp(pattern + "$"), "");
}
function trimEnd(str, ...chars) {
    return chars.length === 0
        ? str.trimEnd()
        : str.replace(new RegExp("[" + escape(chars.join("")) + "]+$"), "");
}
function substring(str, startIndex, length) {
    if ((startIndex + (length || 0) > str.length)) {
        throw new Exception("Invalid startIndex and/or length");
    }
    return length != null ? str.substr(startIndex, length) : str.substr(startIndex);
}

const SR_inputWasEmpty = "Collection was empty.";
const SR_ArgumentNull_Generic = "Value cannot be null.";
const SR_Arg_ParamName_Name = " (Parameter \'";
const SR_Arg_KeyNotFound = "The given key was not present in the dictionary.";

class InvalidOperationException extends Exception {
    constructor(message) {
        super(message);
    }
}
function InvalidOperationException_$ctor_Z721C83C5(message) {
    return new InvalidOperationException(message);
}
class NotSupportedException extends Exception {
    constructor(message) {
        super(message);
    }
}
function NotSupportedException_$ctor_Z721C83C5(message) {
    return new NotSupportedException(message);
}
class ArgumentException extends Exception {
    paramName;
    constructor(message, paramName, innerException) {
        super(isNullOrEmpty(paramName) ? message : (((message + SR_Arg_ParamName_Name) + paramName) + "\')"), innerException);
        this.paramName = paramName;
    }
}
class ArgumentNullException extends ArgumentException {
    constructor(paramName, message) {
        super(message, paramName, defaultOf());
    }
}
function ArgumentNullException_$ctor_Z384F8060(paramName, message) {
    return new ArgumentNullException(paramName, message);
}
function ArgumentNullException_$ctor_Z721C83C5(paramName) {
    return ArgumentNullException_$ctor_Z384F8060(paramName, SR_ArgumentNull_Generic);
}

function Helpers_allocateArrayFromCons(cons, len) {
    {
        return new Array(len);
    }
}

function tryParse$2(str, defValue) {
    // TODO: test if value is valid and in range
    if (str != null && /\S/.test(str)) {
        const v = +str.replace("_", "");
        if (!Number.isNaN(v)) {
            defValue.contents = v;
            return true;
        }
    }
    return false;
}
function min(x, y) {
    return Math.min(x, y);
}

function fill(target, targetIndex, count, value) {
    const start = targetIndex | 0;
    return target.fill(value, start, (start + count));
}
function map$2(f, source, cons) {
    const len = source.length | 0;
    const target = Helpers_allocateArrayFromCons(cons, len);
    for (let i = 0; i <= (len - 1); i++) {
        setItem(target, i, f(item(i, source)));
    }
    return target;
}
function singleton$3(value, cons) {
    const ar = Helpers_allocateArrayFromCons(cons, 1);
    setItem(ar, 0, value);
    return ar;
}
function choose$2(chooser, array, cons) {
    const res = [];
    for (let i = 0; i <= (array.length - 1); i++) {
        const matchValue = chooser(item(i, array));
        if (matchValue != null) {
            const y = value(matchValue);
            res.push(y);
        }
    }
    {
        return res;
    }
}
function fold$3(folder, state, array) {
    const folder_1 = folder;
    return array.reduce((folder_1), state);
}
function sortBy(projection, xs, comparer) {
    const xs_1 = xs.slice();
    xs_1.sort((x, y) => (comparer.Compare(projection(x), projection(y)) | 0));
    return xs_1;
}
function equalsWith(equals, source1, source2) {
    if (Operators_IsNull(source1)) {
        if (Operators_IsNull(source2)) {
            return true;
        }
        else {
            return false;
        }
    }
    else if (Operators_IsNull(source2)) {
        return false;
    }
    else {
        let i = 0;
        let result = true;
        const length1 = source1.length | 0;
        const length2 = source2.length | 0;
        if (length1 > length2) {
            return false;
        }
        else if (length1 < length2) {
            return false;
        }
        else {
            while ((i < length1) && result) {
                result = equals(item(i, source1), item(i, source2));
                i = ((i + 1) | 0);
            }
            return result;
        }
    }
}
function item(index, array) {
    if ((index < 0) ? true : (index >= array.length)) {
        throw new Exception("Index was outside the bounds of the array. (Parameter \'index\')");
    }
    else {
        return array[index];
    }
}
function setItem(array, index, value) {
    if ((index < 0) ? true : (index >= array.length)) {
        throw new Exception("Index was outside the bounds of the array. (Parameter \'index\')");
    }
    else {
        array[index] = value;
    }
}

function Operators_IsNull(value) {
    if (equals$1(value, defaultOf())) {
        return true;
    }
    else {
        return false;
    }
}
function Operators_NullArgCheck(argumentName, value) {
    if (equals$1(value, defaultOf())) {
        throw ArgumentNullException_$ctor_Z721C83C5(argumentName);
    }
    else {
        return value;
    }
}

const SR_enumerationAlreadyFinished = "Enumeration already finished.";
const SR_enumerationNotStarted = "Enumeration has not started. Call MoveNext.";
const SR_resetNotSupported = "Reset is not supported on this enumerator.";
function Enumerator_noReset() {
    throw NotSupportedException_$ctor_Z721C83C5(SR_resetNotSupported);
}
function Enumerator_notStarted() {
    throw InvalidOperationException_$ctor_Z721C83C5(SR_enumerationNotStarted);
}
function Enumerator_alreadyFinished() {
    throw InvalidOperationException_$ctor_Z721C83C5(SR_enumerationAlreadyFinished);
}
class Enumerator_Seq {
    f;
    constructor(f) {
        this.f = f;
    }
    toString() {
        const xs = this;
        let i = 0;
        let str = "seq [";
        const e = getEnumerator(xs);
        try {
            while ((i < 4) && e["System.Collections.IEnumerator.MoveNext"]()) {
                if (i > 0) {
                    str = (str + "; ");
                }
                str = (str + toString$2(e["System.Collections.Generic.IEnumerator`1.get_Current"]()));
                i = ((i + 1) | 0);
            }
            if (i === 4) {
                str = (str + "; ...");
            }
            return str + "]";
        }
        finally {
            disposeSafe(e);
        }
    }
    GetEnumerator() {
        const x = this;
        return x.f();
    }
    [Symbol.iterator]() {
        return toIterator(getEnumerator(this));
    }
    "System.Collections.IEnumerable.GetEnumerator"() {
        const x = this;
        return x.f();
    }
}
function Enumerator_Seq_$ctor_673A07F2(f) {
    return new Enumerator_Seq(f);
}
class Enumerator_FromFunctions$1 {
    next;
    dispose;
    current;
    constructor(current, next, dispose) {
        this.current = current;
        this.next = next;
        this.dispose = dispose;
    }
    "System.Collections.Generic.IEnumerator`1.get_Current"() {
        const _ = this;
        return _.current();
    }
    "System.Collections.IEnumerator.get_Current"() {
        const _ = this;
        return _.current();
    }
    "System.Collections.IEnumerator.MoveNext"() {
        const _ = this;
        return _.next();
    }
    "System.Collections.IEnumerator.Reset"() {
        Enumerator_noReset();
    }
    Dispose() {
        const _ = this;
        _.dispose();
    }
}
function Enumerator_FromFunctions$1_$ctor_58C54629(current, next, dispose) {
    return new Enumerator_FromFunctions$1(current, next, dispose);
}
function Enumerator_concat(sources) {
    let outerOpt = undefined;
    let innerOpt = undefined;
    let started = false;
    let finished = false;
    let curr = undefined;
    const finish = () => {
        finished = true;
        if (innerOpt != null) {
            const inner = value(innerOpt);
            try {
                disposeSafe(inner);
            }
            finally {
                innerOpt = undefined;
            }
        }
        if (outerOpt != null) {
            const outer = value(outerOpt);
            try {
                disposeSafe(outer);
            }
            finally {
                outerOpt = undefined;
            }
        }
    };
    return Enumerator_FromFunctions$1_$ctor_58C54629(() => {
        if (!started) {
            Enumerator_notStarted();
        }
        else if (finished) {
            Enumerator_alreadyFinished();
        }
        if (curr != null) {
            return value(curr);
        }
        else {
            return Enumerator_alreadyFinished();
        }
    }, () => {
        if (!started) {
            started = true;
        }
        if (finished) {
            return false;
        }
        else {
            let res = undefined;
            while (res == null) {
                let copyOfStruct = undefined;
                const outerOpt_1 = outerOpt;
                const innerOpt_1 = innerOpt;
                if (outerOpt_1 != null) {
                    if (innerOpt_1 != null) {
                        const inner_1 = value(innerOpt_1);
                        if (inner_1["System.Collections.IEnumerator.MoveNext"]()) {
                            curr = some(inner_1["System.Collections.Generic.IEnumerator`1.get_Current"]());
                            res = true;
                        }
                        else {
                            try {
                                disposeSafe(inner_1);
                            }
                            finally {
                                innerOpt = undefined;
                            }
                        }
                    }
                    else {
                        const outer_1 = value(outerOpt_1);
                        if (outer_1["System.Collections.IEnumerator.MoveNext"]()) {
                            const ie = outer_1["System.Collections.Generic.IEnumerator`1.get_Current"]();
                            innerOpt = ((copyOfStruct = ie, getEnumerator(copyOfStruct)));
                        }
                        else {
                            finish();
                            res = false;
                        }
                    }
                }
                else {
                    outerOpt = getEnumerator(sources);
                }
            }
            return value(res);
        }
    }, () => {
        if (!finished) {
            finish();
        }
    });
}
function Enumerator_generateWhileSome(openf, compute, closef) {
    let started = false;
    let curr = undefined;
    let state = some(openf());
    const dispose = () => {
        if (state != null) {
            const x_1 = value(state);
            try {
                closef(x_1);
            }
            finally {
                state = undefined;
            }
        }
    };
    const finish = () => {
        try {
            dispose();
        }
        finally {
            curr = undefined;
        }
    };
    return Enumerator_FromFunctions$1_$ctor_58C54629(() => {
        if (!started) {
            Enumerator_notStarted();
        }
        if (curr != null) {
            return value(curr);
        }
        else {
            return Enumerator_alreadyFinished();
        }
    }, () => {
        if (!started) {
            started = true;
        }
        if (state != null) {
            const s = value(state);
            let matchValue_1;
            try {
                matchValue_1 = compute(s);
            }
            catch (matchValue) {
                finish();
                throw matchValue;
            }
            if (matchValue_1 != null) {
                curr = matchValue_1;
                return true;
            }
            else {
                finish();
                return false;
            }
        }
        else {
            return false;
        }
    }, dispose);
}
function mkSeq(f) {
    return Enumerator_Seq_$ctor_673A07F2(f);
}
function ofSeq$2(xs) {
    return getEnumerator(Operators_NullArgCheck("source", xs));
}
function delay(generator) {
    return mkSeq(() => getEnumerator(generator()));
}
function concat(sources) {
    return mkSeq(() => Enumerator_concat(sources));
}
function empty$2() {
    return delay(() => (new Array(0)));
}
function singleton$2(x) {
    return delay(() => singleton$3(x));
}
function toList$1(xs) {
    if (isArrayLike(xs)) {
        return ofArray$1(xs);
    }
    else if (xs instanceof FSharpList) {
        return xs;
    }
    else {
        return ofSeq$1(xs);
    }
}
function generate(create, compute, dispose) {
    return mkSeq(() => Enumerator_generateWhileSome(create, compute, dispose));
}
function append$1(xs, ys) {
    return concat([xs, ys]);
}
function choose$1(chooser, xs) {
    return generate(() => ofSeq$2(xs), (e) => {
        let curr = undefined;
        while ((curr == null) && e["System.Collections.IEnumerator.MoveNext"]()) {
            curr = chooser(e["System.Collections.Generic.IEnumerator`1.get_Current"]());
        }
        return curr;
    }, (e_1) => {
        disposeSafe(e_1);
    });
}
function compareWith(comparer, xs, ys) {
    const e1 = ofSeq$2(xs);
    try {
        const e2 = ofSeq$2(ys);
        try {
            let c = 0;
            let b1 = e1["System.Collections.IEnumerator.MoveNext"]();
            let b2 = e2["System.Collections.IEnumerator.MoveNext"]();
            while (((c === 0) && b1) && b2) {
                c = (comparer(e1["System.Collections.Generic.IEnumerator`1.get_Current"](), e2["System.Collections.Generic.IEnumerator`1.get_Current"]()) | 0);
                if (c === 0) {
                    b1 = e1["System.Collections.IEnumerator.MoveNext"]();
                    b2 = e2["System.Collections.IEnumerator.MoveNext"]();
                }
            }
            return ((c !== 0) ? c : (b1 ? 1 : (b2 ? -1 : 0))) | 0;
        }
        finally {
            disposeSafe(e2);
        }
    }
    finally {
        disposeSafe(e1);
    }
}
function filter(f, xs) {
    return choose$1((x) => {
        if (f(x)) {
            return some(x);
        }
        else {
            return undefined;
        }
    }, xs);
}
function exists$1(predicate, xs) {
    const e = ofSeq$2(xs);
    try {
        let found = false;
        while (!found && e["System.Collections.IEnumerator.MoveNext"]()) {
            found = predicate(e["System.Collections.Generic.IEnumerator`1.get_Current"]());
        }
        return found;
    }
    finally {
        disposeSafe(e);
    }
}
function fold$2(folder, state, xs) {
    const e = ofSeq$2(xs);
    try {
        let acc = state;
        while (e["System.Collections.IEnumerator.MoveNext"]()) {
            acc = folder(acc, e["System.Collections.Generic.IEnumerator`1.get_Current"]());
        }
        return acc;
    }
    finally {
        disposeSafe(e);
    }
}
function iterate(action, xs) {
    fold$2((unitVar, x) => {
        action(x);
    }, undefined, xs);
}
function iterateIndexed(action, xs) {
    fold$2((i, x) => {
        action(i, x);
        return (i + 1) | 0;
    }, 0, xs);
}
function map$1(mapping, xs) {
    return generate(() => ofSeq$2(xs), (e) => (e["System.Collections.IEnumerator.MoveNext"]() ? some(mapping(e["System.Collections.Generic.IEnumerator`1.get_Current"]())) : undefined), (e_1) => {
        disposeSafe(e_1);
    });
}
function collect(mapping, xs) {
    return delay(() => concat(map$1(mapping, xs)));
}

class KeyNotFoundException extends Exception {
    constructor(message) {
        super(message);
    }
}
function KeyNotFoundException_$ctor_Z721C83C5(message) {
    return new KeyNotFoundException(message);
}
function KeyNotFoundException_$ctor() {
    return KeyNotFoundException_$ctor_Z721C83C5(SR_Arg_KeyNotFound);
}

class FSharpList extends Record {
    head;
    tail;
    constructor(head, tail) {
        super();
        this.head = head;
        this.tail = tail;
    }
    toString() {
        const xs = this;
        let result = "[";
        let first = true;
        const enumerator = getEnumerator(xs);
        try {
            while (enumerator["System.Collections.IEnumerator.MoveNext"]()) {
                let x = undefined, matchValue = undefined, s = undefined;
                const x_1 = enumerator["System.Collections.Generic.IEnumerator`1.get_Current"]();
                result = ((first ? result : (result + "; ")) + ((x = x_1, (matchValue = x, (typeof matchValue === "string") ? ((s = matchValue, ("\"" + s) + "\"")) : toString$2(x)))));
                first = false;
            }
        }
        finally {
            disposeSafe(enumerator);
        }
        return result + "]";
    }
    Equals(other) {
        const xs = this;
        if (xs === other) {
            return true;
        }
        else if (other instanceof FSharpList) {
            const ys = other;
            const loop = (xs_1_mut, ys_1_mut) => {
                loop: while (true) {
                    const xs_1 = xs_1_mut, ys_1 = ys_1_mut;
                    const matchValue = xs_1.tail;
                    const matchValue_1 = ys_1.tail;
                    if (matchValue != null) {
                        if (matchValue_1 != null) {
                            const xt = value(matchValue);
                            const yt = value(matchValue_1);
                            if (equals$1(xs_1.head, ys_1.head)) {
                                xs_1_mut = xt;
                                ys_1_mut = yt;
                                continue loop;
                            }
                            else {
                                return false;
                            }
                        }
                        else {
                            return false;
                        }
                    }
                    else if (matchValue_1 != null) {
                        return false;
                    }
                    else {
                        return true;
                    }
                }
            };
            return loop(xs, ys);
        }
        else {
            return false;
        }
    }
    GetHashCode() {
        const xs = this;
        const loop = (i_mut, h_mut, xs_1_mut) => {
            loop: while (true) {
                const i = i_mut, h = h_mut, xs_1 = xs_1_mut;
                const matchValue = xs_1.tail;
                if (matchValue != null) {
                    const t = value(matchValue);
                    if (i > 18) {
                        return h | 0;
                    }
                    else {
                        i_mut = (i + 1);
                        h_mut = (((h << 1) + structuralHash(xs_1.head)) + (631 * i));
                        xs_1_mut = t;
                        continue loop;
                    }
                }
                else {
                    return h | 0;
                }
            }
        };
        return loop(0, 0, xs) | 0;
    }
    toJSON() {
        const this$ = this;
        return Array.from(this$);
    }
    CompareTo(other) {
        const xs = this;
        if (other instanceof FSharpList) {
            const ys = other;
            const loop = (xs_1_mut, ys_1_mut) => {
                loop: while (true) {
                    const xs_1 = xs_1_mut, ys_1 = ys_1_mut;
                    const matchValue = xs_1.tail;
                    const matchValue_1 = ys_1.tail;
                    if (matchValue != null) {
                        if (matchValue_1 != null) {
                            const xt = value(matchValue);
                            const yt = value(matchValue_1);
                            const c = compare$1(xs_1.head, ys_1.head) | 0;
                            if (c === 0) {
                                xs_1_mut = xt;
                                ys_1_mut = yt;
                                continue loop;
                            }
                            else {
                                return c | 0;
                            }
                        }
                        else {
                            return 1;
                        }
                    }
                    else if (matchValue_1 != null) {
                        return -1;
                    }
                    else {
                        return 0;
                    }
                }
            };
            return loop(xs, ys) | 0;
        }
        else {
            return 1;
        }
    }
    GetEnumerator() {
        const xs = this;
        return ListEnumerator$1_$ctor_3002E699(xs);
    }
    [Symbol.iterator]() {
        return toIterator(getEnumerator(this));
    }
    "System.Collections.IEnumerable.GetEnumerator"() {
        const xs = this;
        return getEnumerator(xs);
    }
}
class ListEnumerator$1 {
    xs;
    it;
    current;
    constructor(xs) {
        this.xs = xs;
        this.it = this.xs;
        this.current = defaultOf();
    }
    "System.Collections.Generic.IEnumerator`1.get_Current"() {
        const _ = this;
        return _.current;
    }
    "System.Collections.IEnumerator.get_Current"() {
        const _ = this;
        return _.current;
    }
    "System.Collections.IEnumerator.MoveNext"() {
        const _ = this;
        const matchValue = _.it.tail;
        if (matchValue != null) {
            const t = value(matchValue);
            _.current = _.it.head;
            _.it = t;
            return true;
        }
        else {
            return false;
        }
    }
    "System.Collections.IEnumerator.Reset"() {
        const _ = this;
        _.it = _.xs;
        _.current = defaultOf();
    }
    Dispose() {
    }
}
function ListEnumerator$1_$ctor_3002E699(xs) {
    return new ListEnumerator$1(xs);
}
function FSharpList_get_Empty() {
    return new FSharpList(defaultOf(), undefined);
}
function FSharpList_Cons_305B8EAC(x, xs) {
    return new FSharpList(x, xs);
}
function FSharpList__get_IsEmpty(xs) {
    return xs.tail == null;
}
function FSharpList__get_Length(xs) {
    const loop = (i_mut, xs_1_mut) => {
        loop: while (true) {
            const i = i_mut, xs_1 = xs_1_mut;
            const matchValue = xs_1.tail;
            if (matchValue != null) {
                i_mut = (i + 1);
                xs_1_mut = value(matchValue);
                continue loop;
            }
            else {
                return i | 0;
            }
        }
    };
    return loop(0, xs) | 0;
}
function FSharpList__get_Head(xs) {
    const matchValue = xs.tail;
    if (matchValue != null) {
        return xs.head;
    }
    else {
        throw new Exception(SR_inputWasEmpty + " (Parameter \'list\')");
    }
}
function FSharpList__get_Tail(xs) {
    const matchValue = xs.tail;
    if (matchValue != null) {
        return value(matchValue);
    }
    else {
        throw new Exception(SR_inputWasEmpty + " (Parameter \'list\')");
    }
}
function empty$1() {
    return FSharpList_get_Empty();
}
function cons(x, xs) {
    return FSharpList_Cons_305B8EAC(x, xs);
}
function singleton$1(x) {
    return FSharpList_Cons_305B8EAC(x, FSharpList_get_Empty());
}
function isEmpty(xs) {
    return FSharpList__get_IsEmpty(xs);
}
function head(xs) {
    return FSharpList__get_Head(xs);
}
function tail(xs) {
    return FSharpList__get_Tail(xs);
}
function toArray(xs) {
    const len = FSharpList__get_Length(xs) | 0;
    const res = fill(new Array(len), 0, len, null);
    const loop = (i_mut, xs_1_mut) => {
        loop: while (true) {
            const i = i_mut, xs_1 = xs_1_mut;
            if (!FSharpList__get_IsEmpty(xs_1)) {
                setItem(res, i, FSharpList__get_Head(xs_1));
                i_mut = (i + 1);
                xs_1_mut = FSharpList__get_Tail(xs_1);
                continue loop;
            }
            break;
        }
    };
    loop(0, xs);
    return res;
}
function fold$1(folder, state, xs) {
    let acc = state;
    let xs_1 = xs;
    while (!FSharpList__get_IsEmpty(xs_1)) {
        acc = folder(acc, head(xs_1));
        xs_1 = FSharpList__get_Tail(xs_1);
    }
    return acc;
}
function reverse(xs) {
    return fold$1((acc, x) => FSharpList_Cons_305B8EAC(x, acc), FSharpList_get_Empty(), xs);
}
function ofArrayWithTail(xs, tail_1) {
    let res = tail_1;
    for (let i = xs.length - 1; i >= 0; i--) {
        res = FSharpList_Cons_305B8EAC(item(i, xs), res);
    }
    return res;
}
function ofArray$1(xs) {
    return ofArrayWithTail(xs, FSharpList_get_Empty());
}
function ofSeq$1(xs) {
    if (isArrayLike(xs)) {
        return ofArray$1(xs);
    }
    else if (xs instanceof FSharpList) {
        return xs;
    }
    else {
        const root = FSharpList_get_Empty();
        let node = root;
        const enumerator = getEnumerator(xs);
        try {
            while (enumerator["System.Collections.IEnumerator.MoveNext"]()) {
                let xs_3 = undefined, t = undefined;
                const x = enumerator["System.Collections.Generic.IEnumerator`1.get_Current"]();
                node = ((xs_3 = node, (t = (new FSharpList(x, undefined)), (xs_3.tail = t, t))));
            }
        }
        finally {
            disposeSafe(enumerator);
        }
        const xs_5 = node;
        const t_2 = FSharpList_get_Empty();
        xs_5.tail = t_2;
        return FSharpList__get_Tail(root);
    }
}
function append(xs, ys) {
    return fold$1((acc, x) => FSharpList_Cons_305B8EAC(x, acc), ys, reverse(xs));
}
function map(mapping, xs) {
    const root = FSharpList_get_Empty();
    const node = fold$1((acc, x) => {
        const t = new FSharpList(mapping(x), undefined);
        acc.tail = t;
        return t;
    }, root, xs);
    const t_2 = FSharpList_get_Empty();
    node.tail = t_2;
    return FSharpList__get_Tail(root);
}
function tryFindIndex(f, xs) {
    const loop = (i_mut, xs_1_mut) => {
        loop: while (true) {
            const i = i_mut, xs_1 = xs_1_mut;
            if (FSharpList__get_IsEmpty(xs_1)) {
                return undefined;
            }
            else if (f(FSharpList__get_Head(xs_1))) {
                return i;
            }
            else {
                i_mut = (i + 1);
                xs_1_mut = FSharpList__get_Tail(xs_1);
                continue loop;
            }
        }
    };
    return loop(0, xs);
}
function choose(f, xs) {
    const root = FSharpList_get_Empty();
    const node = fold$1((acc, x) => {
        const matchValue = f(x);
        if (matchValue == null) {
            return acc;
        }
        else {
            const t = new FSharpList(value(matchValue), undefined);
            acc.tail = t;
            return t;
        }
    }, root, xs);
    const t_2 = FSharpList_get_Empty();
    node.tail = t_2;
    return FSharpList__get_Tail(root);
}
function contains(value, xs, eq) {
    return tryFindIndex((v) => eq.Equals(value, v), xs) != null;
}
function exists(f, xs) {
    return tryFindIndex(f, xs) != null;
}

function FSharpResult$2_Ok(ResultValue) {
    return new FSharpResult$2(0, [ResultValue]);
}
function FSharpResult$2_Error$(ErrorValue) {
    return new FSharpResult$2(1, [ErrorValue]);
}
class FSharpResult$2 extends Union {
    constructor(tag, fields) {
        super();
        this.tag = tag;
        this.fields = fields;
    }
    tag;
    fields;
    cases() {
        return ["Ok", "Error"];
    }
}
function Result_Map(mapping, result) {
    if (result.tag === /* Ok */ 0) {
        return FSharpResult$2_Ok(mapping(result.fields[0]));
    }
    else {
        return FSharpResult$2_Error$(result.fields[0]);
    }
}
function Result_MapError(mapping, result) {
    if (result.tag === /* Ok */ 0) {
        return FSharpResult$2_Ok(result.fields[0]);
    }
    else {
        return FSharpResult$2_Error$(mapping(result.fields[0]));
    }
}

class VersionChange extends Record {
    Name;
    Previous;
    Current;
    constructor(Name, Previous, Current) {
        super();
        this.Name = Name;
        this.Previous = Previous;
        this.Current = Current;
    }
}
function VersionChange_$reflection() {
    return record_type("PaketaBot.VersionChange", [], VersionChange, () => [["Name", string_type], ["Previous", string_type], ["Current", string_type]]);
}
class RunnerStatus extends Union {
    constructor(tag, fields) {
        super();
        this.tag = tag;
        this.fields = fields;
    }
    tag;
    fields;
    cases() {
        return ["NoChange", "Updated", "Rejected", "Failed"];
    }
    static NoChange = new RunnerStatus(0, []);
    static Updated = new RunnerStatus(1, []);
    static Rejected = new RunnerStatus(2, []);
    static Failed = new RunnerStatus(3, []);
}
function RunnerStatus_$reflection() {
    return union_type("PaketaBot.RunnerStatus", [], RunnerStatus, () => [[], [], [], []]);
}
class RunnerResult extends Record {
    Status;
    LockFile;
    Changes;
    Messages;
    constructor(Status, LockFile, Changes, Messages) {
        super();
        this.Status = Status;
        this.LockFile = LockFile;
        this.Changes = Changes;
        this.Messages = Messages;
    }
}
function RunnerResult_$reflection() {
    return record_type("PaketaBot.RunnerResult", [], RunnerResult, () => [["Status", RunnerStatus_$reflection()], ["LockFile", option_type(string_type)], ["Changes", list_type(VersionChange_$reflection())], ["Messages", list_type(string_type)]]);
}
class UpdateOutcome extends Union {
    constructor(tag, fields) {
        super();
        this.tag = tag;
        this.fields = fields;
    }
    tag;
    fields;
    cases() {
        return ["Published", "Unchanged", "RunFailed"];
    }
    static Unchanged = new UpdateOutcome(1, []);
}

class CancellationToken {
    _id;
    _cancelled;
    _listeners;
    constructor(cancelled = false) {
        this._id = 0;
        this._cancelled = cancelled;
        this._listeners = new Map();
    }
    get isCancelled() {
        return this._cancelled;
    }
    cancel() {
        if (!this._cancelled) {
            this._cancelled = true;
            for (const [, listener] of this._listeners) {
                listener();
            }
        }
    }
    addListener(f) {
        const id = this._id;
        this._listeners.set(this._id++, f);
        return id;
    }
    removeListener(id) {
        return this._listeners.delete(id);
    }
    register(f, state) {
        const $ = this;
        const id = this.addListener(state == null ? f : () => f(state));
        return { Dispose() { $.removeListener(id); } };
    }
    Dispose() {
        // Implement IDisposable for compatibility but do nothing
        // According to docs, calling Dispose does not trigger cancellation
        // https://docs.microsoft.com/en-us/dotnet/api/system.threading.cancellationtokensource.dispose?view=net-6.0
    }
}
class OperationCanceledException extends Exception {
    constructor(msg) {
        super(msg ?? "The operation was canceled");
        // Object.setPrototypeOf(this, OperationCanceledException.prototype);
    }
}
class Trampoline {
    static get maxTrampolineCallCount() {
        return 2000;
    }
    callCount;
    // Set once a terminal continuation of the computation has been entered.
    // After that point any exception unwinding through protectedCont comes from
    // user continuation code, not the workflow body, and must propagate instead
    // of being routed to onError (which would resolve the computation twice).
    completed;
    constructor() {
        this.callCount = 0;
        this.completed = false;
    }
    incrementAndCheck() {
        return this.callCount++ > Trampoline.maxTrampolineCallCount;
    }
    hijack(f) {
        this.callCount = 0;
        setTimeout(f, 0);
    }
}
function protectedCont(f) {
    return (ctx) => {
        if (ctx.cancelToken.isCancelled) {
            ctx.onCancel(new OperationCanceledException());
        }
        else if (ctx.trampoline.incrementAndCheck()) {
            ctx.trampoline.hijack(() => {
                try {
                    f(ctx);
                }
                catch (err) {
                    if (ctx.trampoline.completed) {
                        throw err;
                    }
                    ctx.onError(ensureErrorOrException(err));
                }
            });
        }
        else {
            try {
                f(ctx);
            }
            catch (err) {
                // Once a terminal continuation has run the computation is complete, so
                // an exception from user continuation code must propagate rather than be
                // routed to onError (which would resolve the computation a second time,
                // e.g. a succeeded try/with body re-entering its with handler).
                if (ctx.trampoline.completed) {
                    throw err;
                }
                ctx.onError(ensureErrorOrException(err));
            }
        }
    };
}
function protectedBind(computation, binder) {
    return protectedCont((ctx) => {
        computation({
            onSuccess: (x) => {
                // Only guard the binder evaluation itself: the resulting computation
                // is protected on its own, and re-catching what it throws would
                // route continuation exceptions back into onError (double-resolve).
                let bound;
                try {
                    bound = binder(x);
                }
                catch (err) {
                    ctx.onError(ensureErrorOrException(err));
                    return;
                }
                bound(ctx);
            },
            onError: ctx.onError,
            onCancel: ctx.onCancel,
            cancelToken: ctx.cancelToken,
            trampoline: ctx.trampoline,
        });
    });
}
function protectedReturn(value) {
    return protectedCont((ctx) => ctx.onSuccess(value));
}
class AsyncBuilder {
    Bind(computation, binder) {
        return protectedBind(computation, binder);
    }
    Combine(computation1, computation2) {
        return this.Bind(computation1, () => computation2);
    }
    Delay(generator) {
        return protectedCont((ctx) => generator()(ctx));
    }
    For(sequence, body) {
        const iter = sequence[Symbol.iterator]();
        let cur = iter.next();
        return this.While(() => !cur.done, this.Delay(() => {
            const res = body(cur.value);
            cur = iter.next();
            return res;
        }));
    }
    Return(value) {
        return protectedReturn(value);
    }
    ReturnFrom(computation) {
        return computation;
    }
    TryFinally(computation, compensation) {
        return protectedCont((ctx) => {
            computation({
                onSuccess: (x) => {
                    compensation();
                    ctx.onSuccess(x);
                },
                onError: (x) => {
                    compensation();
                    ctx.onError(x);
                },
                onCancel: (x) => {
                    compensation();
                    ctx.onCancel(x);
                },
                cancelToken: ctx.cancelToken,
                trampoline: ctx.trampoline,
            });
        });
    }
    TryWith(computation, catchHandler) {
        return protectedCont((ctx) => {
            computation({
                onSuccess: ctx.onSuccess,
                onCancel: ctx.onCancel,
                cancelToken: ctx.cancelToken,
                trampoline: ctx.trampoline,
                onError: (ex) => {
                    // See protectedBind: only guard the handler evaluation itself.
                    let handled;
                    try {
                        handled = catchHandler(ex);
                    }
                    catch (err) {
                        ctx.onError(ensureErrorOrException(err));
                        return;
                    }
                    handled(ctx);
                },
            });
        });
    }
    Using(resource, binder) {
        return this.TryFinally(binder(resource), () => resource.Dispose());
    }
    While(guard, computation) {
        if (guard()) {
            return this.Bind(computation, () => this.While(guard, computation));
        }
        else {
            return this.Return(void 0);
        }
    }
    Zero() {
        return protectedCont((ctx) => ctx.onSuccess(void 0));
    }
}
const singleton = new AsyncBuilder();

function emptyContinuation(_x) {
    // NOP
}
function awaitPromise(p) {
    return fromContinuations((conts) => p.then(conts[0]).catch((err) => (err instanceof OperationCanceledException
        ? conts[2] : conts[1])(err)));
}
const defaultCancellationToken = new CancellationToken();
function fromContinuations(f) {
    return protectedCont((ctx) => f([ctx.onSuccess, ctx.onError, ctx.onCancel]));
}
function startWithContinuations(computation, continuation, exceptionContinuation, cancellationContinuation, cancelToken) {
    const trampoline = new Trampoline();
    // Mark the computation completed as soon as a terminal continuation is entered
    // so protectedCont lets exceptions from continuation code propagate instead of
    // routing them to onError (see Trampoline.completed).
    const done = (cont) => (x) => { trampoline.completed = true; return cont(x); };
    computation({
        onSuccess: done(continuation ? continuation : emptyContinuation),
        onError: done(exceptionContinuation),
        onCancel: done(cancellationContinuation),
        cancelToken: cancelToken ? cancelToken : defaultCancellationToken,
        trampoline,
    });
}
function startAsPromise(computation, cancellationToken) {
    return new Promise((resolve, reject) => startWithContinuations(computation, resolve, reject, reject, defaultCancellationToken));
}

// Unicode 13.0.0 codepoint ranges (delta encoded) and general categories.
// Integer delta values are offset by 35 and stored as Unicode characters.
const rangeDeltas = "#C$&$&$$$$$$%-%&%=$$$$$$=$$$$D$$'$$$$$$$$$$$$%$$%$$$$&$:$*;$+$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$%$$$$$$$$$$$$$$$%$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$%$$$$&%$$$%$&%'$%$&&%$%$$$$$%$$%$$%$&$$$%%$$&'$$$$$$$$$$$$$$$$$$$$$$$$%$$$$$$$$$$$$$$$$$%$$$$$&$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$*%$%%$$'$$$$$$$$h$>5'/1(*$$$4$$$$$$$$%$&$$'%$$&$$$%$4$,F$%&&$$$$$$$$$$$$$$$$$$$$$$$($$$$$%%VS$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$(%$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$%$$$$$$$$$$$$%$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$I%$)L$$%%$$P$$$%$%$$+>''%.)&%$%%.$$$%C$-8-'%$$$*$$)%%$'%-&%$1$$$$A>%|.$1-D,%$&$%$%9'$,$&$(%2$<&%$$.X8$5.2$C$Y$$$$&+'$%$*-%%-$$2$%$+%%%9$*$$&'%$$&'%%%%$$+$'%$&%%-%%)$$$$$%%$$)'%%9$*$%$%$%%$$&%'%%&&$*'$$*-%&$$-%$$,$&$9$*$%$(%$$&($%$$%$%$2%%%-$$*$)$$%$+%%%9$*$%$(%$$$$$'%%%%$*%$'%$&%%-$$)-$$$)&&$'&%$$$%&%&&&/'%$%&&$&$%$)$1-&)$$($&$+$&$:$3&$&'$&$'*%$&(%%%-*$*$$$%$+$&$:$-$(%$$$$($$%$%%*%*$$%%%-$%0%%,$&$L%$&'$&$&$$$'&$*&%%-,$)$$%$5&;$,$$%*&$'&&$$$+)-%%$/S$%*'$)$+$-%H%$$$($;$$$-$%,$%($$$)%-%'C$&2$$&%)--$$$$$$$$$$%+$G'1$($%(.$G$+$)$%('%HN%'$)$%%%$-))%%'&$&%*&'0$%%)$$$-&$%I$$($%N$$&Ŭ$'%*$$$'%L$'%D$'%*$$$'%2$\\$'%f%&,7&3-)y%)%$ʏ$$4$=$$&n&&+*0$'&.5&%,5%/0$&$%/W%$*+$%.&$&$$$%-)-))$'&$$-)F$X*(%E$$(i-B$&'%&'%$)&'$&%-A%(.O'=)-$&E:%%$%%X$$$*$$$$%+)-%$-)-)*$)%1$%b'$R$$($$($%*'-*-,,&%$A$'%%$&%-O$$%&$$&%+'G++%%&(-&&-A)%,*N%&++&$0$*'$)$%$%$(Ob0$EH]$($$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$,$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$,+)%)%++++)%)%+$$$$$$$$++1%++++++($%'$$$&&$%'$&'%%'$&+(&%&$%'$%$.()%$$$%$$$+$$($,$$'%&$$$.$$$-$($-$$%)&$$$-&$$$0&C30'$&/2%$'$%$&%&$$$%$()$$$$$$'$$'$'$%%%($'$$%$$3F$$'$%'((%'$%$%$*$B%%$$$Bį+$$$$7%*$$t$A<K)h<.8_q9Ú$,$Y+$ě$$$$$$$$$$$$$$AO($$B$$$$$$$$$$3ģ¦$$$$$$$$$$$$$$$$$$$$$$b$$$$C$$ĥS8%)J%C$R$R$$$&%$$$$$$'$$%$)%&$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$%)$$$$&$$('$%I$$($%[*$$1$:,*$*$*$*$*$*$*$*$C%$$$$&$$$$$,$%$$$$%$$$$$$$$$$($-%'$$$0%$P=$|/ù=/'$&$$$$$$$$$$$$$$%$$$$$$$$$$%$,'%$(%&$$$%$y%%%%$$}$&$(N$$%'-CG/3B$-A+$2C-J2ţ᧣c删&8$Қ&Z,K)%į$&3-%7$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$&$-$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$%%i-%)+:,%$$$$$$$$$$$$$&$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$+$$$$%$$$$$$$$$$%$$$$$$$$&$$$$$$$$$$$$$$$$$$$$($($$$$$$$$$$$%$$'$$$M$$$%$*$&$'$:%%$'$&)%$$)W'+%U3%+%-)5)&$$%$-?+%:.%.$@&&$R$%'%%&0$$-'%($$,-($L)%%%%,&$+$$%-%'3$)&$$$$U$$&%%(%$$$;%$%.$%%%$%$$-)%)%),*$*$N$',$%'sF%$%$%$$$%-)⯇/:'T'ࠣᤣƑ%I*/(($$-$0$($$$%$%$34Ǝ$$3c%YK/$$%3*$$$)3$%%$$$$$$$$$$$$$$$$%$$'&&$'$$$$$$$&$$&$$$%'($ª%$$&$&$$$$$$%-%&%=$$$$$$=$$$$$$$$$%-$P%B&)%)%)%&&%$$$%$$'%-&%%/$=$6$%$2%1E(&'P&,X'4%&$0&$RP$¥@&T2$>'C',7$+$(I((A$$G'+$(MKKq%-)G'G'K+W.$³Ś,9-+»)%$$O$%&$%:$$+:%*B+,S6$%((9)&$=($c['%%3%Q$&$%(''$&$@%&'$,*,*@%$@&C+$?%'(*,Y&*9%+6(+5*'/*slZV0V*)G'+-ŉB$M$%$%%q@-$+9.'(y8*7:,$$$X2*'7-2&$P&'%%%$'.$%<*-)&G($+$-'$%$+F$%$,%$S&,%'''$$$-$$$&$7.5$<&&%$$%)$d*$$$'$2$-$)R$&+(-)%%$+%%%9$*$%$($%$%$'%%%&%$)$((%%*&(®X&+%&$$'(-%$$$&AS&)$$'%$%%$$+-ÉR&'%'%$%:'%ES&+%$$%&$.-)06N$$$%)$$$*-Y>%&%'$('-%&$ãO&,$%$CC-,/+%$%+$%$;)$%%%$$$$$$$&,-i+%J&'%%'$$$$$>$-K)$$'+$+$)%&Q0$%&$(@\\Ī,$H$*$)$$$(--6&%A%9$$*$%$%l*$%$I)&$$%$*$$+-))$%$C($%$%$$$$*-ř6%%%Ú$28+'40$ν$(.ç૟ђ$,࿪ɪ⇜ɜ*B$-'%A%($-S*(''$$--$*$8(6˓CC:'n'$$Z*'0c%$$$.%1᠛+ӹM,⌚łT&4'+Ưध(0&,*-%$%$'፿ę-J%_%&&)++%*A'^:e&$½7/z,<ª===*$5==$$%%$%%%'$+'$$$*$.==%$'%+$*$=%$'$($$&*$============?%<$<$)<$<$)<$<$)<$<$)<$<$)$$%UȣZ'U+$1$%(2($2ճ*$4%*$%$(øP&**%-'$$ƓO'-($ԣè%,*LEE*$'-'%̴^$&$'oP$2å'$>$%$$%$$-$'$$$$)$'$$$$$$&$%$$%$$$$$$$$$$%$$%'$*$'$'$$$-$4(&$($4W%ıO'/2%2$2$H-0Ä[@0O',*%1)½Ğ(˻+0&0&/|*/7/'[+-)K+A%%q$u$ª/1%(&&(*,<**,&0*L¶$ZH-Щ꜁Eၘ.ā%ᚥ1ᵔూɁ؅፮򮳙$A£ē︳𐀡%𐀡";
const categories = "1.;=;78;<;6;+;<;#7;8>5>$7<8<1.;=?;>?'9<2?>?<->$;>-':-;#<#$<$#$#$#$#$#$#$#$#$#$#$#$#$#$#$#$#$#$#$#$#$#$#$#$#$#$#$#$#$#$#$#$#$#$#$#$#$#$#$#$#$#$#$#$#$#$#$#$#$#$#$#$#$#$#$#$#$#$#$#$#$#$#$#$#$#$#$#$#$#$#$#$#$#$#$#$#$#$#$#$#$'#$'#%$#%$#%$#$#$#$#$#$#$#$#$#$#$#$#$#$#$#$#$#$#%$#$#$#$#$#$#$#$#$#$#$#$#$#$#$#$#$#$#$#$#$#$#$#$#$#$#$#$#$#$#$#$#$#$#$#$#$#$#$#$'$&>&>&>&>&>(#$#$&>#$@&$;#@>#;#@#@#$#@#$#$#$#$#$#$#$#$#$#$#$#$#$#$#$#$<#$#$#$#$#$#$#$#$#$#$#$#$#$#$#$#$#$#$#$#$?(*#$#$#$#$#$#$#$#$#$#$#$#$#$#$#$#$#$#$#$#$#$#$#$#$#$#$#$#$#$#$#$#$#$#$#$#$#$#$#$#$#$#$#$#$#$#$#$#$#$#$#$#$#$#$#$#$#$#$#$#$#$#$#$#$#$#$#$#$#$#$#$#$#$#$#$#$#$#$#$#$#$#$@#@&;$;6@?=@(6(;(;(;(@'@';@2<;=;?(;2@;'&'(+;'(';'(2?(&(?('+'?';@2'('(@'('@+'(&?;&@(='(&(&(&(@;@'(@;@'@'@'@(2()'()(')()()'('(;+;&'()@'@'@'@'@'@'@(')(@)@)('@)@'@'(@+'=-?=';(@()@'@'@'@'@'@'@'@(@)(@(@(@(@'@'@+('(;@()@'@'@'@'@'@'@(')(@()@)(@'@'(@+;=@'(@()@'@'@'@'@'@'@(')()(@)@)(@()@'@'(@+?'-@('@'@'@'@'@'@'@'@'@'@)()@)@)(@'@)@+-?=?@()('@'@'@'@'()@(@(@(@'@'(@+@;-?'();'@'@'@'@'@(')()@()@)(@)@'@'(@+@'@()'@'@'(')(@)@)('?@')-'(@+-?'@()@'@'@'@'@'@(@)(@(@)@+@);@'('(@='&(;+;@'@'@'@'@'@'('('@'@&@(@+@'@'?;?;?(?+-?(?(?(7878)'@'@()(;('(@(@?(?@?;?;@')()()()('+;')('(')')'('()()(')+)(?#@#@#@$;&$'@'@'@'@'@'@'@'@'@'@'@'@'@'@'@'@(;-@'?@#@$@6'?;'.'78@';,'@'@'(@'(;@'(@'@'@(@'()()()(;&;='(@+@-@;6;(2@+@'&'@'('('@'@'@()()@)()(@?@;+'@'@'@'@+-@?'()(@;')()(@()()()(@(+@+@;&;@(*(@()'()()()()'@+;?(?@()')()()('+'()()()()@;')()(@;+@'+'&;$@#@#;@(;()('('(')('@$&$&$&(@(#$#$#$#$#$#$#$#$#$#$#$#$#$#$#$#$#$#$#$#$#$#$#$#$#$#$#$#$#$#$#$#$#$#$#$#$#$#$#$#$#$#$#$#$#$#$#$#$#$#$#$#$#$#$#$#$#$#$#$#$#$#$#$#$#$#$#$#$#$#$#$#$#$#$#$#$#$#$#$#$#$#$#$#$#$#$#$#$#$#$#$#$#$#$#$#$#$#$#$#$#$#$#$#$#$#$#$#$#$#$#$#$#$#$#$#$#$#$#$#$#$#$#$#$#$@#@$#$#$@#@$@#@#@#@#$#$@$%$%$%$@$#%>$>$@$#%>$@$#@>$#>@$@$#%>@.26;9:79:79;/02.;9:;5;<78;<;5;.2@2-&@-<78&-<78@&@=@(*(*(@?#?#?$#$#$?#?<#?#?#?#?#?$#$'$?$#<#$?<?$?-,#$,-?@<?<?<?<?<?<?<?<?<?<?7878?<?78?<?<?<?@?@-?-?<?<?<?<?78787878787878-?<78<7878787878<?<7878787878787878787878<7878<78<?<?<?@?@?#@$@#$#$#$#$#$#$#$#$&#$#$#$#$#$#$#$#$#$#$#$#$#$#$#$#$#$#$#$#$#$#$#$#$#$#$#$#$#$#$#$#$#$#$#$#$#$#$#$#$#$#$#$#$#$#$#$#$#$#$?#$#$(#$@;-;$@$@$@'@&;@('@'@'@'@'@'@'@'@'@(;9:9:;9:;9:;6;6;9:;9:78787878;&;6;6;7;?;@?@?@?@?@.;?&',7878787878?78787878678?,()6&?,&';?@'@(>&'6';&'@'@'@?-?'?@'?@-?-?-?-?-?'?'@'&'@?@'&;'&;'+'@#$#$#$#$#$#$#$#$#$#$#$#$#$#$#$#$#$#$#$#$#$#$#$'(*;(;&#$#$#$#$#$#$#$#$#$#$#$#$#$#$&(',(;@>&>#$#$#$#$#$#$#$#$#$#$#$#$#$#$#$#$#$#$#$#$#$#$#$#$#$#$#$#$#$#$#$#$#$#$#$#$#$#$&$#$#$#$#$#$#$#$&>#$#$'#$#$#$#$#$#$#$#$#$#$#$#$#$#$#$#$#$#$#$@#$#$#$@#$'&$'('('(')()?(@-?=?@';@)')(@;+@(';';'(+'(;'()@;'@()'()()();@&+@;'(&'+'@'()()(@'('()@+@;'&'?')()'('('('('('@'&;')();'&)(@'@'@'@'@'@$>&$&>@$')()();)(@+@'@'@'@34'@'@$@$@'('<'@'@'@'@'@'>@'87@'@'@'=?@(;78;@(;657878787878787878;78;5;@;6787878;<6<@;=;@'@'@2@;=;78;<;6;+;<;#7;8>5>$7<8<78;78;'&'&'@'@'@'@'@=<>?=@?<?@2?@'@'@'@'@'@'@'@;@-@?,-?-?@?@?@?(@'@'@(-@'-@',',@'(@'@;'@';,@#$'@+@#@$@'@'@;@'@'@'@'@'@'@'@'@'@;-'?-'@-@'@'@-'-@;'@;@'@-'-@-'(@(@('@'@'@(@(-@;@'-;'-@'?'(@-;@'@;'@-'@-'@;@-@'@#@$@-'(@+@-@'@(6@'@'-'@'(-;@'-@'@)()'(;@-+@()')()(;2;@2@'@+@('()(@+;')'@'(;'@()')()';(;)(+';';@-@'@')()()(;(@'@'@'@'@';@'()(@+@()@'@'@'@'@'@'@(')()@)@)@'@)@')@(@(@')()()(';+;@;('@')()()()(';'@+@')(@)()(;'(@')()()(;'@+@;@'()()()('@+@'@()()(@+-;?@')()(;@#$+-@'@'@'@'@')@)@()(')')(;@+@'@')(@()(';')@'('()'(;(@'()('()(;';@'@'@')(@()(';@+-@;'@(@)()()(@'@'@'(@(@(@('(@+@'@'@')@(@)()('@+@'();@'@-?=?@;'@,@;@'@'@2@'@'@'@+@;@'@(;@'(;?&;?@+@-@'@'@#$-;@'@(')@(&@&;&(@)@'@'@'@'@'@'@'@'@'@'@'@?(;2@?@?@?)(?)2(?(?(?@?(?@-@?@-@#$#$@$#$#@#@#@#@#@#$@$@$@$#$#@#@#@#@$#@#@#@#@#@$#$#$#$#$#$#$@#<$<$#<$<$#<$<$#<$<$#<$<$#$@+?(?(?(?(?;@(@(@(@(@(@(@(@'@(&@+@'?@'(+@=@'@-(@#$(&@+@;@-?-=-@-?-@'@'@'@'@'@'@'@'@'@'@'@'@'@'@'@'@'@'@'@'@'@'@'@'@'@'@'@'@'@'@'@'@'@<@?@?@?@?@?@?@-?@?@?@?@?@?@?>?@?@?@?@?@?@?@?@?@?@?@?@?@?@?@?@?@?@?@?@?@?@?@?@?@+@'@'@'@'@'@'@'@2@2@(@4@4@";

function getCategoryFunc() {
    // unpack Unicode codepoint ranges (delta encoded) and general categories
    const offset = 35; // offsets unprintable characters
    const a1 = [...rangeDeltas].map((ch) => (ch.codePointAt(0) ?? 0) - offset);
    const a2 = [...categories].map((ch) => (ch.codePointAt(0) ?? 0) - offset);
    const codepoints = new Uint32Array(a1);
    const categories$1 = new Uint8Array(a2);
    for (let i = 1; i < codepoints.length; ++i) {
        codepoints[i] += codepoints[i - 1];
    }
    // binary search in unicode ranges
    return (cp) => {
        let hi = codepoints.length;
        let lo = 0;
        while (hi - lo > 1) {
            const mid = Math.floor((hi + lo) / 2);
            const test = codepoints[mid];
            if (cp < test) {
                hi = mid;
            }
            else if (cp === test) {
                hi = lo = mid;
                break;
            }
            else if (test < cp) {
                lo = mid;
            }
        }
        return categories$1[lo];
    };
}
const UnicodeCategory = {
    UppercaseLetter: 0};
const isUpperMask = 1 << UnicodeCategory.UppercaseLetter;
const unicodeCategoryFunc = getCategoryFunc();
function charCodeAt(s, index) {
    if (index < s.length) {
        return s.charCodeAt(index);
    }
    else {
        throw new Exception("Index out of range.");
    }
}
const isUpper = (s) => isUpper2(s, 0);
function getUnicodeCategory2(s, index) {
    const cp = charCodeAt(s, index);
    return unicodeCategoryFunc(cp);
}
function isUpper2(s, index) {
    const test = 1 << getUnicodeCategory2(s, index);
    return (test & isUpperMask) !== 0;
}

/**
 * Lowercase the first character; leave the rest alone.
 */
function lowerFirst(name) {
    if (name.length === 0) {
        return name;
    }
    else {
        return name[0].toLowerCase() + name.slice(1, name.length);
    }
}
/**
 * Convert a snake_case name back to PascalCase.
 */
function fromSnakeCase(name) {
    return join("", map$2((part) => {
        if (part.length === 0) {
            return part;
        }
        else {
            return part[0].toUpperCase() + part.slice(1, part.length);
        }
    }, split(name, ["_"], undefined, 0)));
}
/**
 * True if the name contains any uppercase letter (i.e., looks like Pascal/camelCase
 * rather than snake_case). Used to decide whether to convert before applying a rule.
 */
function hasUpper(name) {
    return exists$1(isUpper, name.split(""));
}
function toCanonicalPascal(name) {
    if (hasUpper(name)) {
        return name;
    }
    else {
        return fromSnakeCase(name);
    }
}

class MapTreeLeaf$2 {
    v;
    k;
    constructor(k, v) {
        this.k = k;
        this.v = v;
    }
}
function MapTreeLeaf$2_$ctor_5BDDA1(k, v) {
    return new MapTreeLeaf$2(k, v);
}
function MapTreeLeaf$2__get_Key(_) {
    return _.k;
}
function MapTreeLeaf$2__get_Value(_) {
    return _.v;
}
class MapTreeNode$2 extends MapTreeLeaf$2 {
    right;
    left;
    h;
    constructor(k, v, left, right, h) {
        super(k, v);
        this.left = left;
        this.right = right;
        this.h = (h | 0);
    }
}
function MapTreeNode$2_$ctor_Z39DE9543(k, v, left, right, h) {
    return new MapTreeNode$2(k, v, left, right, h);
}
function MapTreeNode$2__get_Left(_) {
    return _.left;
}
function MapTreeNode$2__get_Right(_) {
    return _.right;
}
function MapTreeNode$2__get_Height(_) {
    return _.h | 0;
}
function MapTreeModule_empty() {
    return undefined;
}
function MapTreeModule_sizeAux(acc_mut, m_mut) {
    MapTreeModule_sizeAux: while (true) {
        const acc = acc_mut, m = m_mut;
        if (m != null) {
            const m2 = value(m);
            if (m2 instanceof MapTreeNode$2) {
                const mn = m2;
                acc_mut = MapTreeModule_sizeAux(acc + 1, MapTreeNode$2__get_Left(mn));
                m_mut = MapTreeNode$2__get_Right(mn);
                continue MapTreeModule_sizeAux;
            }
            else {
                return (acc + 1) | 0;
            }
        }
        else {
            return acc | 0;
        }
    }
}
function MapTreeModule_size(x) {
    return MapTreeModule_sizeAux(0, x) | 0;
}
function MapTreeModule_mk(l, k, v, r) {
    let mn = undefined, mn_1 = undefined;
    let hl;
    const m = l;
    if (m != null) {
        const m2 = value(m);
        hl = ((m2 instanceof MapTreeNode$2) ? ((mn = m2, MapTreeNode$2__get_Height(mn))) : 1);
    }
    else {
        hl = 0;
    }
    let hr;
    const m_1 = r;
    if (m_1 != null) {
        const m2_1 = value(m_1);
        hr = ((m2_1 instanceof MapTreeNode$2) ? ((mn_1 = m2_1, MapTreeNode$2__get_Height(mn_1))) : 1);
    }
    else {
        hr = 0;
    }
    const m_2 = ((hl < hr) ? hr : hl) | 0;
    if (m_2 === 0) {
        return MapTreeLeaf$2_$ctor_5BDDA1(k, v);
    }
    else {
        return MapTreeNode$2_$ctor_Z39DE9543(k, v, l, r, m_2 + 1);
    }
}
function MapTreeModule_rebalance(t1, k, v, t2) {
    let mn = undefined, mn_1 = undefined, m_2 = undefined, m2_2 = undefined, mn_2 = undefined, m_3 = undefined, m2_3 = undefined, mn_3 = undefined;
    let t1h;
    const m = t1;
    if (m != null) {
        const m2 = value(m);
        t1h = ((m2 instanceof MapTreeNode$2) ? ((mn = m2, MapTreeNode$2__get_Height(mn))) : 1);
    }
    else {
        t1h = 0;
    }
    let t2h;
    const m_1 = t2;
    if (m_1 != null) {
        const m2_1 = value(m_1);
        t2h = ((m2_1 instanceof MapTreeNode$2) ? ((mn_1 = m2_1, MapTreeNode$2__get_Height(mn_1))) : 1);
    }
    else {
        t2h = 0;
    }
    if (t2h > (t1h + 2)) {
        const matchValue = value(t2);
        if (matchValue instanceof MapTreeNode$2) {
            const t2$0027 = matchValue;
            if (((m_2 = MapTreeNode$2__get_Left(t2$0027), (m_2 != null) ? ((m2_2 = value(m_2), (m2_2 instanceof MapTreeNode$2) ? ((mn_2 = m2_2, MapTreeNode$2__get_Height(mn_2))) : 1)) : 0)) > (t1h + 1)) {
                const matchValue_1 = value(MapTreeNode$2__get_Left(t2$0027));
                if (matchValue_1 instanceof MapTreeNode$2) {
                    const t2l = matchValue_1;
                    return MapTreeModule_mk(MapTreeModule_mk(t1, k, v, MapTreeNode$2__get_Left(t2l)), MapTreeLeaf$2__get_Key(t2l), MapTreeLeaf$2__get_Value(t2l), MapTreeModule_mk(MapTreeNode$2__get_Right(t2l), MapTreeLeaf$2__get_Key(t2$0027), MapTreeLeaf$2__get_Value(t2$0027), MapTreeNode$2__get_Right(t2$0027)));
                }
                else {
                    throw new Exception("internal error: Map.rebalance");
                }
            }
            else {
                return MapTreeModule_mk(MapTreeModule_mk(t1, k, v, MapTreeNode$2__get_Left(t2$0027)), MapTreeLeaf$2__get_Key(t2$0027), MapTreeLeaf$2__get_Value(t2$0027), MapTreeNode$2__get_Right(t2$0027));
            }
        }
        else {
            throw new Exception("internal error: Map.rebalance");
        }
    }
    else if (t1h > (t2h + 2)) {
        const matchValue_2 = value(t1);
        if (matchValue_2 instanceof MapTreeNode$2) {
            const t1$0027 = matchValue_2;
            if (((m_3 = MapTreeNode$2__get_Right(t1$0027), (m_3 != null) ? ((m2_3 = value(m_3), (m2_3 instanceof MapTreeNode$2) ? ((mn_3 = m2_3, MapTreeNode$2__get_Height(mn_3))) : 1)) : 0)) > (t2h + 1)) {
                const matchValue_3 = value(MapTreeNode$2__get_Right(t1$0027));
                if (matchValue_3 instanceof MapTreeNode$2) {
                    const t1r = matchValue_3;
                    return MapTreeModule_mk(MapTreeModule_mk(MapTreeNode$2__get_Left(t1$0027), MapTreeLeaf$2__get_Key(t1$0027), MapTreeLeaf$2__get_Value(t1$0027), MapTreeNode$2__get_Left(t1r)), MapTreeLeaf$2__get_Key(t1r), MapTreeLeaf$2__get_Value(t1r), MapTreeModule_mk(MapTreeNode$2__get_Right(t1r), k, v, t2));
                }
                else {
                    throw new Exception("internal error: Map.rebalance");
                }
            }
            else {
                return MapTreeModule_mk(MapTreeNode$2__get_Left(t1$0027), MapTreeLeaf$2__get_Key(t1$0027), MapTreeLeaf$2__get_Value(t1$0027), MapTreeModule_mk(MapTreeNode$2__get_Right(t1$0027), k, v, t2));
            }
        }
        else {
            throw new Exception("internal error: Map.rebalance");
        }
    }
    else {
        return MapTreeModule_mk(t1, k, v, t2);
    }
}
function MapTreeModule_add(comparer, k, v, m) {
    if (m != null) {
        const m2 = value(m);
        const c = comparer.Compare(k, MapTreeLeaf$2__get_Key(m2)) | 0;
        if (m2 instanceof MapTreeNode$2) {
            const mn = m2;
            if (c < 0) {
                return MapTreeModule_rebalance(MapTreeModule_add(comparer, k, v, MapTreeNode$2__get_Left(mn)), MapTreeLeaf$2__get_Key(mn), MapTreeLeaf$2__get_Value(mn), MapTreeNode$2__get_Right(mn));
            }
            else if (c === 0) {
                return MapTreeNode$2_$ctor_Z39DE9543(k, v, MapTreeNode$2__get_Left(mn), MapTreeNode$2__get_Right(mn), MapTreeNode$2__get_Height(mn));
            }
            else {
                return MapTreeModule_rebalance(MapTreeNode$2__get_Left(mn), MapTreeLeaf$2__get_Key(mn), MapTreeLeaf$2__get_Value(mn), MapTreeModule_add(comparer, k, v, MapTreeNode$2__get_Right(mn)));
            }
        }
        else if (c < 0) {
            return MapTreeNode$2_$ctor_Z39DE9543(k, v, MapTreeModule_empty(), m, 2);
        }
        else if (c === 0) {
            return MapTreeLeaf$2_$ctor_5BDDA1(k, v);
        }
        else {
            return MapTreeNode$2_$ctor_Z39DE9543(k, v, m, MapTreeModule_empty(), 2);
        }
    }
    else {
        return MapTreeLeaf$2_$ctor_5BDDA1(k, v);
    }
}
function MapTreeModule_tryFind(comparer_mut, k_mut, m_mut) {
    MapTreeModule_tryFind: while (true) {
        const comparer = comparer_mut, k = k_mut, m = m_mut;
        if (m != null) {
            const m2 = value(m);
            const c = comparer.Compare(k, MapTreeLeaf$2__get_Key(m2)) | 0;
            if (c === 0) {
                return some(MapTreeLeaf$2__get_Value(m2));
            }
            else if (m2 instanceof MapTreeNode$2) {
                const mn = m2;
                comparer_mut = comparer;
                k_mut = k;
                m_mut = ((c < 0) ? MapTreeNode$2__get_Left(mn) : MapTreeNode$2__get_Right(mn));
                continue MapTreeModule_tryFind;
            }
            else {
                return undefined;
            }
        }
        else {
            return undefined;
        }
    }
}
function MapTreeModule_find(comparer, k, m) {
    const matchValue = MapTreeModule_tryFind(comparer, k, m);
    if (matchValue == null) {
        throw KeyNotFoundException_$ctor();
    }
    else {
        return value(matchValue);
    }
}
function MapTreeModule_mem(comparer_mut, k_mut, m_mut) {
    MapTreeModule_mem: while (true) {
        const comparer = comparer_mut, k = k_mut, m = m_mut;
        if (m != null) {
            const m2 = value(m);
            const c = comparer.Compare(k, MapTreeLeaf$2__get_Key(m2)) | 0;
            if (m2 instanceof MapTreeNode$2) {
                const mn = m2;
                if (c < 0) {
                    comparer_mut = comparer;
                    k_mut = k;
                    m_mut = MapTreeNode$2__get_Left(mn);
                    continue MapTreeModule_mem;
                }
                else if (c === 0) {
                    return true;
                }
                else {
                    comparer_mut = comparer;
                    k_mut = k;
                    m_mut = MapTreeNode$2__get_Right(mn);
                    continue MapTreeModule_mem;
                }
            }
            else {
                return c === 0;
            }
        }
        else {
            return false;
        }
    }
}
function MapTreeModule_iterOpt(f_mut, m_mut) {
    MapTreeModule_iterOpt: while (true) {
        const f = f_mut, m = m_mut;
        if (m != null) {
            const m2 = value(m);
            if (m2 instanceof MapTreeNode$2) {
                const mn = m2;
                MapTreeModule_iterOpt(f, MapTreeNode$2__get_Left(mn));
                f(MapTreeLeaf$2__get_Key(mn), MapTreeLeaf$2__get_Value(mn));
                f_mut = f;
                m_mut = MapTreeNode$2__get_Right(mn);
                continue MapTreeModule_iterOpt;
            }
            else {
                f(MapTreeLeaf$2__get_Key(m2), MapTreeLeaf$2__get_Value(m2));
            }
        }
        break;
    }
}
function MapTreeModule_iter(f, m) {
    MapTreeModule_iterOpt(f, m);
}
function MapTreeModule_foldOpt(f_mut, x_mut, m_mut) {
    MapTreeModule_foldOpt: while (true) {
        const f = f_mut, x = x_mut, m = m_mut;
        if (m != null) {
            const m2 = value(m);
            if (m2 instanceof MapTreeNode$2) {
                const mn = m2;
                f_mut = f;
                x_mut = f(MapTreeModule_foldOpt(f, x, MapTreeNode$2__get_Left(mn)), MapTreeLeaf$2__get_Key(mn), MapTreeLeaf$2__get_Value(mn));
                m_mut = MapTreeNode$2__get_Right(mn);
                continue MapTreeModule_foldOpt;
            }
            else {
                return f(x, MapTreeLeaf$2__get_Key(m2), MapTreeLeaf$2__get_Value(m2));
            }
        }
        else {
            return x;
        }
    }
}
function MapTreeModule_fold(f, x, m) {
    return MapTreeModule_foldOpt(f, x, m);
}
function MapTreeModule_toList(m) {
    const loop = (m_1_mut, acc_mut) => {
        loop: while (true) {
            const m_1 = m_1_mut, acc = acc_mut;
            if (m_1 != null) {
                const m2 = value(m_1);
                if (m2 instanceof MapTreeNode$2) {
                    const mn = m2;
                    m_1_mut = MapTreeNode$2__get_Left(mn);
                    acc_mut = cons([MapTreeLeaf$2__get_Key(mn), MapTreeLeaf$2__get_Value(mn)], loop(MapTreeNode$2__get_Right(mn), acc));
                    continue loop;
                }
                else {
                    return cons([MapTreeLeaf$2__get_Key(m2), MapTreeLeaf$2__get_Value(m2)], acc);
                }
            }
            else {
                return acc;
            }
        }
    };
    return loop(m, empty$1());
}
function MapTreeModule_copyToArray(m, arr, i) {
    let j = i;
    MapTreeModule_iter((x, y) => {
        setItem(arr, j, [x, y]);
        j = ((j + 1) | 0);
    }, m);
}
function MapTreeModule_ofList(comparer, l) {
    return fold$1((acc, tupledArg) => MapTreeModule_add(comparer, tupledArg[0], tupledArg[1], acc), MapTreeModule_empty(), l);
}
function MapTreeModule_mkFromEnumerator(comparer_mut, acc_mut, e_mut) {
    MapTreeModule_mkFromEnumerator: while (true) {
        const comparer = comparer_mut, acc = acc_mut, e = e_mut;
        if (e["System.Collections.IEnumerator.MoveNext"]()) {
            const patternInput = e["System.Collections.Generic.IEnumerator`1.get_Current"]();
            comparer_mut = comparer;
            acc_mut = MapTreeModule_add(comparer, patternInput[0], patternInput[1], acc);
            e_mut = e;
            continue MapTreeModule_mkFromEnumerator;
        }
        else {
            return acc;
        }
    }
}
function MapTreeModule_ofArray(comparer, arr) {
    let res = MapTreeModule_empty();
    for (let idx = 0; idx <= (arr.length - 1); idx++) {
        const forLoopVar = item(idx, arr);
        res = MapTreeModule_add(comparer, forLoopVar[0], forLoopVar[1], res);
    }
    return res;
}
function MapTreeModule_ofSeq(comparer, c) {
    if (isArrayLike(c)) {
        return MapTreeModule_ofArray(comparer, c);
    }
    else if (c instanceof FSharpList) {
        return MapTreeModule_ofList(comparer, c);
    }
    else {
        const ie = getEnumerator(c);
        try {
            return MapTreeModule_mkFromEnumerator(comparer, MapTreeModule_empty(), ie);
        }
        finally {
            disposeSafe(ie);
        }
    }
}
/**
 * Imperative left-to-right iterators.
 */
class MapTreeModule_MapIterator$2 extends Record {
    stack;
    started;
    constructor(stack, started) {
        super();
        this.stack = stack;
        this.started = started;
    }
}
function MapTreeModule_collapseLHS(stack_mut) {
    MapTreeModule_collapseLHS: while (true) {
        const stack = stack_mut;
        if (!isEmpty(stack)) {
            const rest = tail(stack);
            const m = head(stack);
            if (m != null) {
                const m2 = value(m);
                if (m2 instanceof MapTreeNode$2) {
                    const mn = m2;
                    stack_mut = ofArrayWithTail([MapTreeNode$2__get_Left(mn), MapTreeLeaf$2_$ctor_5BDDA1(MapTreeLeaf$2__get_Key(mn), MapTreeLeaf$2__get_Value(mn)), MapTreeNode$2__get_Right(mn)], rest);
                    continue MapTreeModule_collapseLHS;
                }
                else {
                    return stack;
                }
            }
            else {
                stack_mut = rest;
                continue MapTreeModule_collapseLHS;
            }
        }
        else {
            return empty$1();
        }
    }
}
function MapTreeModule_mkIterator(m) {
    return new MapTreeModule_MapIterator$2(MapTreeModule_collapseLHS(singleton$1(m)), false);
}
function MapTreeModule_notStarted() {
    throw new Exception("enumeration not started");
}
function MapTreeModule_alreadyFinished() {
    throw new Exception("enumeration already finished");
}
function MapTreeModule_current(i) {
    if (i.started) {
        const matchValue = i.stack;
        if (!isEmpty(matchValue)) {
            if (head(matchValue) != null) {
                const m = value(head(matchValue));
                if (m instanceof MapTreeNode$2) {
                    throw new Exception("Please report error: Map iterator, unexpected stack for current");
                }
                else {
                    return [MapTreeLeaf$2__get_Key(m), MapTreeLeaf$2__get_Value(m)];
                }
            }
            else {
                throw new Exception("Please report error: Map iterator, unexpected stack for current");
            }
        }
        else {
            return MapTreeModule_alreadyFinished();
        }
    }
    else {
        return MapTreeModule_notStarted();
    }
}
function MapTreeModule_moveNext(i) {
    if (i.started) {
        const matchValue = i.stack;
        if (!isEmpty(matchValue)) {
            if (head(matchValue) != null) {
                const m = value(head(matchValue));
                if (m instanceof MapTreeNode$2) {
                    throw new Exception("Please report error: Map iterator, unexpected stack for moveNext");
                }
                else {
                    i.stack = MapTreeModule_collapseLHS(tail(matchValue));
                    return !isEmpty(i.stack);
                }
            }
            else {
                throw new Exception("Please report error: Map iterator, unexpected stack for moveNext");
            }
        }
        else {
            return false;
        }
    }
    else {
        i.started = true;
        return !isEmpty(i.stack);
    }
}
function MapTreeModule_mkIEnumerator(m) {
    let i = MapTreeModule_mkIterator(m);
    return {
        "System.Collections.Generic.IEnumerator`1.get_Current"() {
            return MapTreeModule_current(i);
        },
        "System.Collections.IEnumerator.get_Current"() {
            return MapTreeModule_current(i);
        },
        "System.Collections.IEnumerator.MoveNext"() {
            return MapTreeModule_moveNext(i);
        },
        "System.Collections.IEnumerator.Reset"() {
            i = MapTreeModule_mkIterator(m);
        },
        Dispose() {
        },
    };
}
class FSharpMap {
    tree;
    comparer;
    constructor(comparer, tree) {
        this.comparer = comparer;
        this.tree = tree;
    }
    GetHashCode() {
        const this$ = this;
        return FSharpMap__ComputeHashCode(this$) | 0;
    }
    Equals(other) {
        const this$ = this;
        if (other instanceof FSharpMap) {
            const that = other;
            const e1 = getEnumerator(this$);
            try {
                const e2 = getEnumerator(that);
                try {
                    const loop = () => {
                        const m1 = e1["System.Collections.IEnumerator.MoveNext"]();
                        if (m1 === e2["System.Collections.IEnumerator.MoveNext"]()) {
                            if (!m1) {
                                return true;
                            }
                            else {
                                const e1c = e1["System.Collections.Generic.IEnumerator`1.get_Current"]();
                                const e2c = e2["System.Collections.Generic.IEnumerator`1.get_Current"]();
                                if (equals$1(e1c[0], e2c[0]) && equals$1(e1c[1], e2c[1])) {
                                    return loop();
                                }
                                else {
                                    return false;
                                }
                            }
                        }
                        else {
                            return false;
                        }
                    };
                    return loop();
                }
                finally {
                    disposeSafe(e2);
                }
            }
            finally {
                disposeSafe(e1);
            }
        }
        else {
            return false;
        }
    }
    toString() {
        const this$ = this;
        return ("map [" + join("; ", map$1((kv) => format("({0}, {1})", kv[0], kv[1]), this$))) + "]";
    }
    get [Symbol.toStringTag]() {
        return "FSharpMap";
    }
    toJSON() {
        const this$ = this;
        return Array.from(this$);
    }
    GetEnumerator() {
        const _ = this;
        return MapTreeModule_mkIEnumerator(_.tree);
    }
    [Symbol.iterator]() {
        return toIterator(getEnumerator(this));
    }
    "System.Collections.IEnumerable.GetEnumerator"() {
        const _ = this;
        return MapTreeModule_mkIEnumerator(_.tree);
    }
    CompareTo(other) {
        let that = undefined;
        const this$ = this;
        return ((other instanceof FSharpMap) ? ((that = other, compareWith((kvp1, kvp2) => {
            const c = this$.comparer.Compare(kvp1[0], kvp2[0]) | 0;
            return ((c !== 0) ? c : compare$1(kvp1[1], kvp2[1])) | 0;
        }, this$, that))) : 1) | 0;
    }
    "System.Collections.Generic.ICollection`1.Add2B595"(x) {
        throw NotSupportedException_$ctor_Z721C83C5("Map cannot be mutated");
    }
    "System.Collections.Generic.ICollection`1.Clear"() {
        throw NotSupportedException_$ctor_Z721C83C5("Map cannot be mutated");
    }
    "System.Collections.Generic.ICollection`1.Remove2B595"(x) {
        throw NotSupportedException_$ctor_Z721C83C5("Map cannot be mutated");
    }
    "System.Collections.Generic.ICollection`1.Contains2B595"(x) {
        const m = this;
        return FSharpMap__ContainsKey(m, x[0]) && equals$1(FSharpMap__get_Item(m, x[0]), x[1]);
    }
    "System.Collections.Generic.ICollection`1.CopyToZ3B4C077E"(arr, i) {
        const m = this;
        MapTreeModule_copyToArray(m.tree, arr, i);
    }
    "System.Collections.Generic.ICollection`1.get_IsReadOnly"() {
        return true;
    }
    "System.Collections.Generic.ICollection`1.get_Count"() {
        const m = this;
        return FSharpMap__get_Count(m) | 0;
    }
    "System.Collections.Generic.IReadOnlyCollection`1.get_Count"() {
        const m = this;
        return FSharpMap__get_Count(m) | 0;
    }
    get size() {
        const m = this;
        return FSharpMap__get_Count(m) | 0;
    }
    clear() {
        throw new Exception("Map cannot be mutated");
    }
    delete(_arg) {
        throw new Exception("Map cannot be mutated");
    }
    entries() {
        const m = this;
        return map$1((p) => [p[0], p[1]], m);
    }
    get(k) {
        const m = this;
        return FSharpMap__get_Item(m, k);
    }
    has(k) {
        const m = this;
        return FSharpMap__ContainsKey(m, k);
    }
    keys() {
        const m = this;
        return map$1((p) => p[0], m);
    }
    set(k, v) {
        throw new Exception("Map cannot be mutated");
    }
    values() {
        const m = this;
        return map$1((p) => p[1], m);
    }
    forEach(f, thisArg) {
        const m = this;
        iterate((p) => {
            f(p[1], p[0], m);
        }, m);
    }
}
function FSharpMap_$ctor(comparer, tree) {
    return new FSharpMap(comparer, tree);
}
function FSharpMap_Empty(comparer) {
    return FSharpMap_$ctor(comparer, MapTreeModule_empty());
}
function FSharpMap__get_Tree(m) {
    return m.tree;
}
function FSharpMap__Add(m, key, value) {
    return FSharpMap_$ctor(m.comparer, MapTreeModule_add(m.comparer, key, value, m.tree));
}
function FSharpMap__get_Item(m, key) {
    return MapTreeModule_find(m.comparer, key, m.tree);
}
function FSharpMap__get_Count(m) {
    return MapTreeModule_size(m.tree) | 0;
}
function FSharpMap__ContainsKey(m, key) {
    return MapTreeModule_mem(m.comparer, key, m.tree);
}
function FSharpMap__TryFind(m, key) {
    return MapTreeModule_tryFind(m.comparer, key, m.tree);
}
function FSharpMap__ToList(m) {
    return MapTreeModule_toList(m.tree);
}
function FSharpMap__ComputeHashCode(this$) {
    const combineHash = (x, y) => ((((x << 1) + y) + 631) | 0);
    let res = 0;
    const enumerator = getEnumerator(this$);
    try {
        while (enumerator["System.Collections.IEnumerator.MoveNext"]()) {
            const activePatternResult = enumerator["System.Collections.Generic.IEnumerator`1.get_Current"]();
            res = (combineHash(res, structuralHash(activePatternResult[0])) | 0);
            res = (combineHash(res, structuralHash(activePatternResult[1])) | 0);
        }
    }
    finally {
        disposeSafe(enumerator);
    }
    return res | 0;
}
function add(key, value, table) {
    return FSharpMap__Add(table, key, value);
}
function tryFind(key, table) {
    return FSharpMap__TryFind(table, key);
}
function fold(folder, state, table) {
    return MapTreeModule_fold(folder, state, FSharpMap__get_Tree(table));
}
function ofList(elements, comparer) {
    return FSharpMap_$ctor(comparer, MapTreeModule_ofSeq(comparer, elements));
}
function ofArray(elements, comparer) {
    return FSharpMap_$ctor(comparer, MapTreeModule_ofSeq(comparer, elements));
}
function toList(table) {
    return FSharpMap__ToList(table);
}
function empty(comparer) {
    return FSharpMap_Empty(comparer);
}

function JsonValue_JString(stringValue) {
    return new JsonValue(0, [stringValue]);
}
function JsonValue_JInt(intValue) {
    return new JsonValue(1, [intValue]);
}
function JsonValue_JFloat(floatValue) {
    return new JsonValue(2, [floatValue]);
}
function JsonValue_JBool(boolValue) {
    return new JsonValue(3, [boolValue]);
}
function JsonValue_JArray(arrayValue) {
    return new JsonValue(5, [arrayValue]);
}
function JsonValue_JMap(mapValue) {
    return new JsonValue(6, [mapValue]);
}
class JsonValue extends Union {
    constructor(tag, fields) {
        super();
        this.tag = tag;
        this.fields = fields;
    }
    tag;
    fields;
    cases() {
        return ["JString", "JInt", "JFloat", "JBool", "JNull", "JArray", "JMap"];
    }
    static JNull = new JsonValue(4, []);
}
class FieldError extends Record {
    path;
    message;
    constructor(path, message) {
        super();
        this.path = path;
        this.message = message;
    }
}
function JsonSchemaValue_SVStr(Item) {
    return new JsonSchemaValue(0, [Item]);
}
function JsonSchemaValue_SVList(Item) {
    return new JsonSchemaValue(4, [Item]);
}
function JsonSchemaValue_SVDict(Item) {
    return new JsonSchemaValue(5, [Item]);
}
class JsonSchemaValue extends Union {
    constructor(tag, fields) {
        super();
        this.tag = tag;
        this.fields = fields;
    }
    tag;
    fields;
    cases() {
        return ["SVStr", "SVInt", "SVFloat", "SVBool", "SVList", "SVDict"];
    }
}
const emptySchema = empty({
    Compare: (x, y) => (comparePrimitives(x, y) | 0),
});
const emptyRegistry = empty({
    Compare: (x, y) => (comparePrimitives(x, y) | 0),
});
function tryGetCodecEntry(fullName, registry) {
    return tryFind(fullName, registry);
}
function isOptionType(fullName) {
    return fullName.startsWith("Microsoft.FSharp.Core.FSharpOption");
}
function isFSharpListType(fullName) {
    return fullName.startsWith("Microsoft.FSharp.Collections.FSharpList");
}
function getGenericInnerType(t) {
    return item(0, getGenerics(t));
}
/**
 * Lazily wrap a backend-native value as a `JsonValue` for hand-off to
 * user codecs (`IJsonCodec.Decode`). Internal `coerce` never calls this
 * — it routes through `IJsonBackend.IsX` / `AsX` directly. On Fable
 * backends each `JString s` etc. is identity (no allocation thanks to
 * `[<Erase>]` legacy / Fable's representation of struct DUs); on the
 * .NET shim each call allocates a small DU instance.
 */
function toJsonValue(backend, fv) {
    if (backend.IsString(fv)) {
        return JsonValue_JString(backend.AsString(fv));
    }
    else if (backend.IsInt(fv)) {
        return JsonValue_JInt(backend.AsInt(fv));
    }
    else if (backend.IsFloat(fv)) {
        return JsonValue_JFloat(backend.AsFloat(fv));
    }
    else if (backend.IsBool(fv)) {
        return JsonValue_JBool(backend.AsBool(fv));
    }
    else if (backend.IsNull(fv)) {
        return JsonValue.JNull;
    }
    else if (backend.IsArray(fv)) {
        return JsonValue_JArray(fv);
    }
    else if (backend.IsMap(fv)) {
        return JsonValue_JMap(fv);
    }
    else {
        return toFail(printf("toJsonValue: unrecognised value of type %s"))("System.Object");
    }
}
/**
 * Unwrap a `JsonValue` handed back by a user codec's `Encode` into the
 * backend-native form the encode path builds maps out of. The inverse of
 * `toJsonValue`, and the encode-side counterpart to `CodecEntry.decode`.
 *
 * `JArray` / `JMap` payloads are already backend-native (that is what
 * `toJsonValue` put in them), so they pass straight through.
 */
function fromJsonValue(backend, jv) {
    switch (jv.tag) {
        case /* JInt */ 1:
            return jv.fields[0];
        case /* JFloat */ 2:
            return jv.fields[0];
        case /* JBool */ 3:
            return jv.fields[0];
        case /* JNull */ 4:
            return backend.Null;
        case /* JArray */ 5:
            return jv.fields[0];
        case /* JMap */ 6:
            return jv.fields[0];
        default:
            return jv.fields[0];
    }
}
/**
 * Render a backend-native value as a short human-readable string for
 * error messages — replaces the JsonValue pattern match the old
 * coerce-error path used.
 */
function describeValue(backend, fv) {
    if (backend.IsString(fv)) {
        const arg = backend.AsString(fv);
        return toText(printf("string \'%s\'"))(arg);
    }
    else if (backend.IsInt(fv)) {
        const arg_1 = backend.AsInt(fv) | 0;
        return toText(printf("int %d"))(arg_1);
    }
    else if (backend.IsFloat(fv)) {
        const arg_2 = backend.AsFloat(fv);
        return toText(printf("float %f"))(arg_2);
    }
    else if (backend.IsBool(fv)) {
        const arg_3 = backend.AsBool(fv);
        return toText(printf("bool %b"))(arg_3);
    }
    else if (backend.IsNull(fv)) {
        return "null";
    }
    else if (backend.IsArray(fv)) {
        return "array";
    }
    else if (backend.IsMap(fv)) {
        return "map";
    }
    else {
        return "<unknown>";
    }
}
/**
 * Build a `key -> obj option` lookup over a backend-native JSON map.
 * One implementation backing both the internal record/union resolvers and
 * the public adapters — declared ahead of the walker
 * so the recursive group can reference it.
 */
function mapLookup(backend, m, key) {
    if (backend.ContainsKey(m, key)) {
        return some(backend.Get(m, key));
    }
    else {
        return undefined;
    }
}
/**
 * Adapt a Map<string, string> (e.g., ToolCall.input from LLM). Each value
 * is the raw F# string — `coerce` recognises it via `backend.IsString`
 * and dispatches into the string-target arm of the giant primitive
 * pattern (which can also coerce to int / float / bool).
 */
function stringMapAdapter(map, key) {
    const matchValue = tryFind(key, map);
    if (matchValue == null) {
        return undefined;
    }
    else {
        return some(value(matchValue));
    }
}
class LookupSource extends Record {
    Get;
    AsMap;
    constructor(Get, AsMap) {
        super();
        this.Get = Get;
        this.AsMap = AsMap;
    }
}
/**
 * `stringMapAdapter` plus the whole-map face. Values stay raw F# strings —
 * the same shape `Get` hands out, and what every backend's `IsString` /
 * `AsString` pair already accepts.
 */
function stringMapSource(backend, map) {
    return new LookupSource((key) => stringMapAdapter(map, key), () => fold((acc, key_1, value) => backend.Put(acc, key_1, value), backend.NewMap(), map));
}

function validResponse(regexMatch, radix) {
    const [/*all*/ , sign, prefix, digits] = regexMatch;
    return {
        sign: sign || "",
        prefix: prefix || "",
        digits,
        radix,
    };
}
function getRange$1(unsigned, bitsize) {
    switch (bitsize) {
        case 8: return unsigned ? [0, 255] : [-128, 127];
        case 16: return unsigned ? [0, 65535] : [-32768, 32767];
        case 32: return unsigned ? [0, 4294967295] : [-2147483648, 2147483647];
        default: throw new Exception("Invalid bit size.");
    }
}
function getInvalidDigits(radix) {
    switch (radix) {
        case 2: return /[^0-1]/;
        case 8: return /[^0-7]/;
        case 10: return /[^0-9]/;
        case 16: return /[^0-9a-fA-F]/;
        default:
            throw new Exception("Invalid Base.");
    }
}
function getPrefix(radix) {
    switch (radix) {
        case 2: return "0b";
        case 8: return "0o";
        case 10: return "";
        case 16: return "0x";
        default: return "";
    }
}
function getRadix(prefix, style) {
    {
        switch (prefix) {
            case "0b":
            case "0B": return 2;
            case "0o":
            case "0O": return 8;
            case "0x":
            case "0X": return 16;
            default: return 10;
        }
    }
}
function isValid(str, style, radix) {
    const integerRegex = /^\s*([\+\-])?(0[xXoObB])?([0-9a-fA-F]+)\s*$/;
    const res = integerRegex.exec(str.replace(/_/g, ""));
    if (res != null) {
        const [/*all*/ , /*sign*/ , prefix, digits] = res;
        radix = radix || getRadix(prefix);
        const invalidDigits = getInvalidDigits(radix);
        if (!invalidDigits.test(digits)) {
            return validResponse(res, radix);
        }
    }
    return null;
}
function parse$2(str, style, unsigned, bitsize, radix) {
    const res = isValid(str, style, radix);
    if (res != null) {
        let v = Number.parseInt(res.sign + res.digits, res.radix);
        if (!Number.isNaN(v)) {
            const [umin, umax] = getRange$1(true, bitsize);
            if (res.radix !== 10 && v >= umin && v <= umax) {
                v = v << (32 - bitsize) >> (32 - bitsize);
            }
            const [min, max] = getRange$1(unsigned, bitsize);
            if (v >= min && v <= max) {
                return v;
            }
        }
    }
    throw new Exception(`The input string ${str} was not in a correct format.`);
}
function tryParse$1(str, style, unsigned, bitsize, defValue) {
    try {
        defValue.contents = parse$2(str, style, unsigned, bitsize);
        return true;
    }
    catch {
        return false;
    }
}
function op_UnaryNegation_Int32(x) {
    return x === -2147483648 ? x : -x;
}

function getRange(unsigned, bitsize) {
    switch (bitsize) {
        case 64: return unsigned ?
            [0n, 18446744073709551615n] :
            [-9223372036854775808n, 9223372036854775807n];
        default: throw new Exception("Invalid bit size.");
    }
}
function parse$1(str, style, unsigned, bitsize, radix) {
    const res = isValid(str, style, radix);
    if (res != null) {
        let v = fromString(getPrefix(res.radix) + res.digits);
        if (res.sign === "-") {
            v = -v;
        }
        const [umin, umax] = getRange(true, bitsize);
        if (res.radix !== 10 && v >= umin && v <= umax) {
            v = BigInt.asIntN(bitsize, v);
        }
        const [min, max] = getRange(unsigned, bitsize);
        if (v >= min && v <= max) {
            return v;
        }
    }
    throw new Exception(`The input string ${str} was not in a correct format.`);
}
function tryParse(str, style, unsigned, bitsize, defValue) {
    try {
        defValue.contents = parse$1(str, style, unsigned, bitsize);
        return true;
    }
    catch {
        return false;
    }
}

/**
 * DateTimeOffset functions.
 *
 * Note: DateOffset instances are always DateObjects in local
 * timezone (because JS dates are all kinds of messed up).
 * A local date returns UTC epoch when `.getTime()` is called.
 *
 * However, this means that in order to construct an UTC date
 * from a DateOffset with offset of +5 hours, you first need
 * to subtract those 5 hours, than add the "local" offset.
 * As said, all kinds of messed up.
 *
 * Basically; invariant: date.getTime() always return UTC time.
 */
function DateTimeOffset(value, offset) {
    checkOffsetInRange(offset);
    const d = new Date(value);
    d.offset = offset != null ? offset : new Date().getTimezoneOffset() * -6e4;
    return d;
}
function checkOffsetInRange(offset) {
    if (offset != null && offset !== 0) {
        if (offset % 60_000 !== 0) {
            throw new Exception("Offset must be specified in whole minutes.");
        }
        if (Math.abs(offset / 3600000) > 14) {
            throw new Exception("Offset must be within plus or minus 14 hours.");
        }
    }
}
function fromDate(date, offset) {
    let offset2 = 0;
    switch (date.kind) {
        case DateTimeKind.Utc:
            offset2 = 0;
            break;
        case DateTimeKind.Local:
            offset2 = date.getTimezoneOffset() * -6e4;
            if (offset !== offset2) {
                throw new Exception("The UTC Offset of the local dateTime parameter does not match the offset argument.");
            }
            break;
        case DateTimeKind.Unspecified:
        default:
            {
                offset2 = offset;
            }
            break;
    }
    return DateTimeOffset(date.getTime(), offset2);
}
function toUniversalTime(date) {
    return DateTime(date.getTime(), DateTimeKind.Utc);
}

// RFC 4122 compliant. From https://stackoverflow.com/a/13653180/3922220
// const guidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
// Relax GUID parsing, see #1637
const guidRegex = /^[\(\{]{0,2}[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}[\)\}]{0,2}$/;
const guidRegexNoHyphen = /^([0-9a-f]{8})([0-9a-f]{4})([0-9a-f]{4})([0-9a-f]{4})([0-9a-f]{12})$/;
const guidRegexHex = /^\{0x[0-9a-f]{8},(0x[0-9a-f]{4},){2}\{(0x[0-9a-f]{2},){7}0x[0-9a-f]{2}\}\}$/;
/** Validates UUID as specified in RFC4122 (versions 1-5). */
function parse(str) {
    function hyphenateGuid(str) {
        return str.replace(guidRegexNoHyphen, "$1-$2-$3-$4-$5");
    }
    const wsTrimAndLowered = str.trim().toLowerCase();
    if (guidRegex.test(wsTrimAndLowered)) {
        return trim(wsTrimAndLowered, "{", "}", "(", ")");
    }
    else if (guidRegexNoHyphen.test(wsTrimAndLowered)) {
        return hyphenateGuid(wsTrimAndLowered);
    }
    else if (guidRegexHex.test(wsTrimAndLowered)) {
        return hyphenateGuid(wsTrimAndLowered.replace(/[\{\},]|0x/g, ''));
    }
    else {
        throw new Exception("Guid should contain 32 digits with 4 dashes: xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx");
    }
}

/**
 * Cross-type coercion is intentional and load-bearing: LLM tool calls deliver
 * every argument as a string, so `"42"` must reach an `int` field.
 */
function parseInt$(s) {
    let matchValue;
    let outArg = 0;
    matchValue = [tryParse$1(s, 511, false, 32, new FSharpRef(() => (outArg | 0), (v) => {
            outArg = (v | 0);
        })), outArg];
    if (matchValue[0]) {
        return FSharpResult$2_Ok(matchValue[1]);
    }
    else {
        return FSharpResult$2_Error$(toText(printf("cannot parse \'%s\' as int"))(s));
    }
}
function parseInt64(s) {
    let matchValue;
    let outArg = 0n;
    matchValue = [tryParse(s, 511, false, 64, new FSharpRef(() => outArg, (v) => {
            outArg = v;
        })), outArg];
    if (matchValue[0]) {
        return FSharpResult$2_Ok(matchValue[1]);
    }
    else {
        return FSharpResult$2_Error$(toText(printf("cannot parse \'%s\' as int64"))(s));
    }
}
function parseFloat$(s) {
    let matchValue;
    let outArg = 0;
    matchValue = [tryParse$2(s, new FSharpRef(() => outArg, (v) => {
            outArg = v;
        })), outArg];
    if (matchValue[0]) {
        return FSharpResult$2_Ok(matchValue[1]);
    }
    else {
        return FSharpResult$2_Error$(toText(printf("cannot parse \'%s\' as float"))(s));
    }
}
/**
 * Accepts only the two JSON literals, case-insensitively. Deliberately not
 * `"1"` / `"yes"` / `""` — a silent truthiness rule is the wrong default for
 * validating tool input.
 */
function parseBool(s) {
    const matchValue = s.toLocaleLowerCase();
    switch (matchValue) {
        case "true":
            return FSharpResult$2_Ok(true);
        case "false":
            return FSharpResult$2_Ok(false);
        default:
            return FSharpResult$2_Error$(toText(printf("cannot parse \'%s\' as bool"))(s));
    }
}
function splitZoneOffset(s) {
    if (s.length <= 10) {
        return undefined;
    }
    else {
        const tail = substring(s, 10);
        const plus = tail.indexOf("+") | 0;
        const minus = tail.indexOf("-") | 0;
        const signIndex = (((plus >= 0) && (minus >= 0)) ? min(plus, minus) : ((plus >= 0) ? plus : minus)) | 0;
        if (signIndex < 0) {
            return undefined;
        }
        else {
            const offset = substring(tail, signIndex);
            const digits = replace(substring(offset, 1), ":", "");
            if (digits.length < 2) {
                return undefined;
            }
            else {
                const hours = parse$2(substring(digits, 0, 2), 511, false, 32) | 0;
                const minutes = ((digits.length >= 4) ? parse$2(substring(digits, 2, 2), 511, false, 32) : 0) | 0;
                const sign = ((offset[0] === "-") ? -1 : 1) | 0;
                return [substring(s, 0, 10 + signIndex), sign * ((hours * 60) + minutes)];
            }
        }
    }
}
function parseAsUtc(s) {
    let matchValue;
    let outArg = minValue();
    matchValue = [tryParse$3(s, new FSharpRef(() => outArg, (v) => {
            outArg = v;
        })), outArg];
    if (matchValue[0]) {
        return FSharpResult$2_Ok(specifyKind(matchValue[1], 1));
    }
    else {
        return FSharpResult$2_Error$(toText(printf("cannot parse \'%s\' as DateTime"))(s));
    }
}
function parseDateTime(s) {
    const matchValue = splitZoneOffset(s);
    if (matchValue == null) {
        return Result_MapError((_arg) => toText(printf("cannot parse \'%s\' as DateTime"))(s), parseAsUtc((s.endsWith("Z") ? true : s.endsWith("z")) ? substring(s, 0, s.length - 1) : s));
    }
    else {
        const offsetMinutes = value(matchValue)[1] | 0;
        return Result_Map((d) => addMinutes(d, op_UnaryNegation_Int32(offsetMinutes)), parseAsUtc(value(matchValue)[0]));
    }
}
/**
 * A `DateTimeOffset` carries its own offset, so nothing has to be assumed about
 * a bare timestamp — the reason to prefer it over `DateTime` on a wire format.
 * Built from the UTC instant above rather than `DateTimeOffset.TryParse`, which
 * is not implemented consistently across the Fable backends.
 */
function parseDateTimeOffset(s) {
    return Result_MapError((_arg) => toText(printf("cannot parse \'%s\' as DateTimeOffset"))(s), Result_Map((utc) => fromDate(utc, 0), parseDateTime(s)));
}
/**
 * `Guid.Parse` guarded, not `TryParse`: the latter's `byref` overload is not
 * uniformly available across the Fable backends, and a guarded `Parse` is.
 */
function parseGuid(s) {
    try {
        return FSharpResult$2_Ok(parse(s));
    }
    catch (matchValue) {
        return FSharpResult$2_Error$(toText(printf("cannot parse \'%s\' as Guid"))(s));
    }
}
function parseDecimal(s) {
    let matchValue;
    let outArg = new Big("0");
    matchValue = [tryParse$4(s, new FSharpRef(() => outArg, (v) => {
            outArg = v;
        })), outArg];
    if (matchValue[0]) {
        return FSharpResult$2_Ok(matchValue[1]);
    }
    else {
        return FSharpResult$2_Error$(toText(printf("cannot parse \'%s\' as decimal"))(s));
    }
}
function intToString(n) {
    return int32ToString(n);
}
function floatToString(f) {
    return f.toString();
}
/**
 * The JSON literals, not .NET's `"True"` / `"False"`.
 */
function boolToString(b) {
    if (b) {
        return "true";
    }
    else {
        return "false";
    }
}
function dateTimeToString(d) {
    return toString(toUniversalTime$1(d), "yyyy-MM-ddTHH:mm:ss.fffffff") + "Z";
}
/**
 * Rendered in UTC with the `Z` designator, exactly like `dateTimeToString` —
 * the offset is preserved as an instant rather than as a local wall clock.
 */
function dateTimeOffsetToString(d) {
    return toString(toUniversalTime(d), "yyyy-MM-ddTHH:mm:ss.fffffff") + "Z";
}
/**
 * Canonical 8-4-4-4-12, lower case — what `format: uuid` denotes.
 */
function guidToString(g) {
    return g;
}
function decimalToString(d) {
    return toString$1(d);
}

class Plan extends Record {
    Decode;
    Encode;
    Schema;
    Definitions;
    constructor(Decode, Encode, Schema, Definitions) {
        super();
        this.Decode = Decode;
        this.Encode = Encode;
        this.Schema = Schema;
        this.Definitions = Definitions;
    }
}
class FieldPlan extends Record {
    Key;
    Optional;
    TypeName;
    Inner;
    Wrap;
    Read;
    constructor(Key, Optional, TypeName, Inner, Wrap, Read) {
        super();
        this.Key = Key;
        this.Optional = Optional;
        this.TypeName = TypeName;
        this.Inner = Inner;
        this.Wrap = Wrap;
        this.Read = Read;
    }
}
class RecordPlan extends Record {
    Fields;
    Make;
    Title;
    constructor(Fields, Make, Title) {
        super();
        this.Fields = Fields;
        this.Make = Make;
        this.Title = Title;
    }
}
class CasePlan extends Record {
    Tag;
    Info;
    Payload;
    constructor(Tag, Info, Payload) {
        super();
        this.Tag = Tag;
        this.Info = Info;
        this.Payload = Payload;
    }
}
class BuildCtx extends Record {
    Backend;
    Registry;
    KeyTransform;
    TagTransform;
    Building;
    RefMode;
    constructor(Backend, Registry, KeyTransform, TagTransform, Building, RefMode) {
        super();
        this.Backend = Backend;
        this.Registry = Registry;
        this.KeyTransform = KeyTransform;
        this.TagTransform = TagTransform;
        this.Building = Building;
        this.RefMode = RefMode;
    }
}
function joinPath(parent, child) {
    if (child === "") {
        return parent;
    }
    else if (parent === "") {
        return child;
    }
    else if (child.startsWith("[")) {
        return parent + child;
    }
    else {
        return (parent + ".") + child;
    }
}
function under(path, errs) {
    return map((e) => (new FieldError(joinPath(path, e.path), e.message)), errs);
}
function leafError(message) {
    return FSharpResult$2_Error$(singleton$1(new FieldError("", message)));
}
function primitiveNode(typeName) {
    return JsonSchemaValue_SVDict(ofList(singleton$1(["type", JsonSchemaValue_SVStr(typeName)]), {
        Compare: (x, y) => (comparePrimitives(x, y) | 0),
    }));
}
function formatNode(typeName, format) {
    return JsonSchemaValue_SVDict(ofList(ofArray$1([["type", JsonSchemaValue_SVStr(typeName)], ["format", JsonSchemaValue_SVStr(format)]]), {
        Compare: (x, y) => (comparePrimitives(x, y) | 0),
    }));
}
const noDefs = empty({
    Compare: (x, y) => (comparePrimitives(x, y) | 0),
});
function mergeDefs(maps) {
    return fold$1((acc, m) => fold((a, k, v) => add(k, v, a), acc, m), empty({
        Compare: (x, y) => (comparePrimitives(x, y) | 0),
    }), maps);
}
function refOrInline(ctx, key, body, childDefs) {
    const matchValue = ctx.RefMode;
    if (matchValue == null) {
        return [body, childDefs];
    }
    else {
        return [JsonSchemaValue_SVDict(ofList(singleton$1(["$ref", JsonSchemaValue_SVStr(value(matchValue) + key)]), {
                Compare: (x, y) => (comparePrimitives(x, y) | 0),
            })), add(key, body, childDefs)];
    }
}
const discriminatorKey = "type";
function forTypeIn(ctx, t) {
    const fullName$1 = fullName(t);
    const b = ctx.Backend;
    switch (fullName$1) {
        case "System.String":
            return planString(b);
        case "System.Int32":
            return planInt(b);
        case "System.Int64":
            return planInt64(b);
        case "System.Double":
            return planFloat(b);
        case "System.Boolean":
            return planBool(b);
        default: {
            const matchValue = tryGetCodecEntry(fullName$1, ctx.Registry);
            if (matchValue == null) {
                switch (fullName$1) {
                    case "System.DateTime":
                        return planDateTime(b);
                    case "System.DateTimeOffset":
                        return planDateTimeOffset(b);
                    case "System.Guid":
                        return planGuid(b);
                    case "System.Decimal":
                        return planDecimal(b);
                    default:
                        if (isFSharpListType(fullName$1)) {
                            return planSeq(ctx, getGenericInnerType(t), (v_2) => v_2, (_elementType, xs) => xs);
                        }
                        else if (isArray(t)) {
                            return planSeq(ctx, getElementType(t), ofArray$1, (_elementType_2, xs_2) => toArray(xs_2));
                        }
                        else if (isRecord(t)) {
                            if (contains(fullName$1, ctx.Building, {
                                Equals: (x_1, y) => (x_1 === y),
                                GetHashCode: (x_1) => (stringHash(x_1) | 0),
                            })) {
                                return planDeferred(ctx, t);
                            }
                            else {
                                return planRecord(ctx, t);
                            }
                        }
                        else if (isUnion(t)) {
                            if (contains(fullName$1, ctx.Building, {
                                Equals: (x_2, y_1) => (x_2 === y_1),
                                GetHashCode: (x_2) => (stringHash(x_2) | 0),
                            })) {
                                return planDeferred(ctx, t);
                            }
                            else {
                                return planUnion(ctx, t);
                            }
                        }
                        else {
                            const message = toText(printf("cannot decode %s"))(fullName$1);
                            return new Plan((_arg) => leafError(message), (x_3) => x_3, JsonSchemaValue_SVDict(emptySchema), noDefs);
                        }
                }
            }
            else {
                const entry = value(matchValue);
                return new Plan((v) => {
                    const matchValue_1 = entry.decode(toJsonValue(b, v));
                    return (matchValue_1.tag === /* Error */ 1) ? leafError(matchValue_1.fields[0]) : FSharpResult$2_Ok(matchValue_1.fields[0]);
                }, (v_1) => fromJsonValue(b, entry.encode(v_1)), JsonSchemaValue_SVDict(entry.schema), noDefs);
            }
        }
    }
}
function planString(b) {
    return new Plan((v) => {
        let arg = undefined;
        return b.IsString(v) ? FSharpResult$2_Ok(b.AsString(v)) : (b.IsInt(v) ? FSharpResult$2_Ok(intToString(b.AsInt(v))) : (b.IsFloat(v) ? FSharpResult$2_Ok(floatToString(b.AsFloat(v))) : (b.IsBool(v) ? FSharpResult$2_Ok(boolToString(b.AsBool(v))) : leafError((arg = describeValue(b, v), toText(printf("cannot coerce %s to System.String"))(arg))))));
    }, (x) => x, primitiveNode("string"), noDefs);
}
function planInt(b) {
    return new Plan((v) => {
        let arg = undefined;
        if (b.IsInt(v)) {
            return FSharpResult$2_Ok(b.AsInt(v));
        }
        else if (b.IsFloat(v)) {
            return FSharpResult$2_Ok(~~b.AsFloat(v));
        }
        else if (b.IsString(v)) {
            const matchValue = parseInt$(b.AsString(v));
            return (matchValue.tag === /* Error */ 1) ? leafError(matchValue.fields[0]) : FSharpResult$2_Ok(matchValue.fields[0]);
        }
        else {
            return leafError((arg = describeValue(b, v), toText(printf("cannot coerce %s to System.Int32"))(arg)));
        }
    }, (x) => x, primitiveNode("integer"), noDefs);
}
function planInt64(b) {
    return new Plan((v) => {
        let arg = undefined;
        if (b.IsInt(v)) {
            return FSharpResult$2_Ok(toInt64_unchecked(fromInt32(b.AsInt(v))));
        }
        else if (b.IsFloat(v)) {
            return FSharpResult$2_Ok(toInt64_unchecked(fromFloat64(b.AsFloat(v))));
        }
        else if (b.IsString(v)) {
            const matchValue = parseInt64(b.AsString(v));
            return (matchValue.tag === /* Error */ 1) ? leafError(matchValue.fields[0]) : FSharpResult$2_Ok(matchValue.fields[0]);
        }
        else {
            return leafError((arg = describeValue(b, v), toText(printf("cannot coerce %s to System.Int64"))(arg)));
        }
    }, (x) => x, primitiveNode("integer"), noDefs);
}
function planFloat(b) {
    return new Plan((v) => {
        let arg = undefined;
        if (b.IsFloat(v)) {
            return FSharpResult$2_Ok(b.AsFloat(v));
        }
        else if (b.IsInt(v)) {
            return FSharpResult$2_Ok(b.AsInt(v));
        }
        else if (b.IsString(v)) {
            const matchValue = parseFloat$(b.AsString(v));
            return (matchValue.tag === /* Error */ 1) ? leafError(matchValue.fields[0]) : FSharpResult$2_Ok(matchValue.fields[0]);
        }
        else {
            return leafError((arg = describeValue(b, v), toText(printf("cannot coerce %s to System.Double"))(arg)));
        }
    }, (x) => x, primitiveNode("number"), noDefs);
}
function planBool(b) {
    return new Plan((v) => {
        let arg = undefined;
        if (b.IsBool(v)) {
            return FSharpResult$2_Ok(b.AsBool(v));
        }
        else if (b.IsString(v)) {
            const matchValue = parseBool(b.AsString(v));
            return (matchValue.tag === /* Error */ 1) ? leafError(matchValue.fields[0]) : FSharpResult$2_Ok(matchValue.fields[0]);
        }
        else {
            return leafError((arg = describeValue(b, v), toText(printf("cannot coerce %s to System.Boolean"))(arg)));
        }
    }, (x_1) => x_1, primitiveNode("boolean"), noDefs);
}
function planDateTime(b) {
    return new Plan((v) => {
        let arg = undefined;
        if (b.IsString(v)) {
            const matchValue = parseDateTime(b.AsString(v));
            return (matchValue.tag === /* Error */ 1) ? leafError(matchValue.fields[0]) : FSharpResult$2_Ok(matchValue.fields[0]);
        }
        else {
            return leafError((arg = describeValue(b, v), toText(printf("cannot coerce %s to System.DateTime"))(arg)));
        }
    }, dateTimeToString, formatNode("string", "date-time"), noDefs);
}
function planDateTimeOffset(b) {
    return new Plan((v) => {
        let arg = undefined;
        if (b.IsString(v)) {
            const matchValue = parseDateTimeOffset(b.AsString(v));
            return (matchValue.tag === /* Error */ 1) ? leafError(matchValue.fields[0]) : FSharpResult$2_Ok(matchValue.fields[0]);
        }
        else {
            return leafError((arg = describeValue(b, v), toText(printf("cannot coerce %s to System.DateTimeOffset"))(arg)));
        }
    }, dateTimeOffsetToString, formatNode("string", "date-time"), noDefs);
}
function planGuid(b) {
    return new Plan((v) => {
        let arg = undefined;
        if (b.IsString(v)) {
            const matchValue = parseGuid(b.AsString(v));
            return (matchValue.tag === /* Error */ 1) ? leafError(matchValue.fields[0]) : FSharpResult$2_Ok(matchValue.fields[0]);
        }
        else {
            return leafError((arg = describeValue(b, v), toText(printf("cannot coerce %s to System.Guid"))(arg)));
        }
    }, guidToString, formatNode("string", "uuid"), noDefs);
}
function planDecimal(b) {
    return new Plan((v) => {
        let arg = undefined;
        if (b.IsString(v)) {
            const matchValue = parseDecimal(b.AsString(v));
            return (matchValue.tag === /* Error */ 1) ? leafError(matchValue.fields[0]) : FSharpResult$2_Ok(matchValue.fields[0]);
        }
        else {
            return b.IsInt(v) ? FSharpResult$2_Ok(new Big(b.AsInt(v))) : (b.IsFloat(v) ? FSharpResult$2_Ok(new Big(b.AsFloat(v))) : leafError((arg = describeValue(b, v), toText(printf("cannot coerce %s to System.Decimal"))(arg))));
        }
    }, decimalToString, formatNode("string", "decimal"), noDefs);
}
function planSeq(ctx, elementType, extract, builder) {
    const b = ctx.Backend;
    const element = forTypeIn(ctx, elementType);
    const build = curry2(builder)(elementType);
    let expected;
    const arg = name(elementType);
    expected = toText(printf("expected JSON array for %s[]"))(arg);
    return new Plan((v_1) => {
        if (!b.IsArray(v_1)) {
            return leafError(expected);
        }
        else {
            const len = b.ArrayLength(v_1) | 0;
            let i = 0;
            let failure = undefined;
            let acc = empty$1();
            while ((i < len) && (failure == null)) {
                let arg_1 = undefined;
                const matchValue = element.Decode(b.ArrayAt(v_1, i));
                if (matchValue.tag === /* Error */ 1) {
                    const errs = matchValue.fields[0];
                    failure = under((arg_1 = (i | 0), toText(printf("[%d]"))(arg_1)), errs);
                }
                else {
                    const x_1 = matchValue.fields[0];
                    acc = cons(x_1, acc);
                }
                i = ((i + 1) | 0);
            }
            return (failure == null) ? FSharpResult$2_Ok(build(reverse(acc))) : FSharpResult$2_Error$(value(failure));
        }
    }, (v) => {
        const items = map(element.Encode, extract(v));
        return b.BuildArray(items);
    }, JsonSchemaValue_SVDict(ofList(ofArray$1([["type", JsonSchemaValue_SVStr("array")], ["items", element.Schema]]), {
        Compare: (x, y) => (comparePrimitives(x, y) | 0),
    })), element.Definitions);
}
function buildRecordPlan(ctx, t) {
    const inner = new BuildCtx(ctx.Backend, ctx.Registry, ctx.KeyTransform, ctx.TagTransform, cons(fullName(t), ctx.Building), ctx.RefMode);
    return new RecordPlan(map$2((fi) => {
        const isOpt = isOptionType(fullName(fi[1]));
        const innerType = isOpt ? getGenericInnerType(fi[1]) : fi[1];
        return new FieldPlan(ctx.KeyTransform(name(fi)), isOpt, name(innerType), forTypeIn(inner, innerType), isOpt ? (some) : ((x) => x), (record) => getRecordField(record, fi));
    }, getRecordElements(t)), (values) => makeRecord(t, values), name(t));
}
/**
 * Stage 2 for a record. Every key, option test and type name was resolved at
 * construction; this indexes arrays and calls closures.
 *
 * invariant: all fields are attempted and errors accumulate — not fail-fast
 */
function decodeRecordWith(b, rp, lookup) {
    const n = rp.Fields.length | 0;
    const values = fill(new Array(n), 0, n, null);
    let errs = empty$1();
    for (let i = 0; i <= (n - 1); i++) {
        let raw = undefined;
        const f = item(i, rp.Fields);
        const matchValue = lookup(f.Key);
        if (matchValue != null) {
            if ((raw = value(matchValue), b.IsNull(raw))) {
                value(matchValue);
                if (f.Optional) {
                    setItem(values, i, undefined);
                }
                else {
                    errs = cons(new FieldError(f.Key, toText(printf("null where %s was required"))(f.TypeName)), errs);
                }
            }
            else {
                const raw_2 = value(matchValue);
                const matchValue_1 = f.Inner.Decode(raw_2);
                if (matchValue_1.tag === /* Error */ 1) {
                    const es = matchValue_1.fields[0];
                    errs = append(reverse(under(f.Key, es)), errs);
                }
                else {
                    const x = matchValue_1.fields[0];
                    setItem(values, i, f.Wrap(x));
                }
            }
        }
        else if (f.Optional) {
            setItem(values, i, undefined);
        }
        else {
            errs = cons(new FieldError(f.Key, toText(printf("missing field (expected %s)"))(f.TypeName)), errs);
        }
    }
    if (isEmpty(errs)) {
        return FSharpResult$2_Ok(rp.Make(values));
    }
    else {
        return FSharpResult$2_Error$(reverse(errs));
    }
}
/**
 * Stage 2, encode side. Mirror of `decodeRecordWith`: same field array, same
 * keys, so the two cannot disagree about what a record looks like on the wire.
 *
 * adr: an absent optional field emits no key at all, rather than an explicit null
 */
function encodeRecordInto(b, rp, acc0, record) {
    let acc = acc0;
    for (let i = 0; i <= (rp.Fields.length - 1); i++) {
        const f = item(i, rp.Fields);
        const v = f.Read(record);
        if (f.Optional) {
            const matchValue = v;
            if (matchValue == null) ;
            else {
                const inner = value(matchValue);
                acc = b.Put(acc, f.Key, f.Inner.Encode(inner));
            }
        }
        else {
            acc = b.Put(acc, f.Key, f.Inner.Encode(v));
        }
    }
    return acc;
}
/**
 * The object schema for a record plan. `properties` reads the same `Key` the
 * decoder looks up and the encoder writes, so a case rule or alias cannot
 * apply to two of the three and not the third.
 *
 * An optional field contributes its inner type's schema and is simply absent
 * from `required` — JSON Schema has no separate notion of optionality.
 */
function recordSchema(rp) {
    const properties = ofArray$1(map$2((f) => [f.Key, f.Inner.Schema], rp.Fields));
    const required = ofArray$1(choose$2((f_1) => {
        if (f_1.Optional) {
            return undefined;
        }
        else {
            return JsonSchemaValue_SVStr(f_1.Key);
        }
    }, rp.Fields));
    const baseSchema = ofList(ofArray$1([["type", JsonSchemaValue_SVStr("object")], ["title", JsonSchemaValue_SVStr(rp.Title)], ["properties", JsonSchemaValue_SVDict(ofList(properties, {
                Compare: (x, y) => (comparePrimitives(x, y) | 0),
            }))]]), {
        Compare: (x_1, y_1) => (comparePrimitives(x_1, y_1) | 0),
    });
    if (isEmpty(required)) {
        return baseSchema;
    }
    else {
        return add("required", JsonSchemaValue_SVList(required), baseSchema);
    }
}
function planRecord(ctx, t) {
    const b = ctx.Backend;
    const rp = buildRecordPlan(ctx, t);
    const expected = toText(printf("expected JSON object for %s"))(rp.Title);
    const childDefs = mergeDefs(ofArray$1(map$2((f) => f.Inner.Definitions, rp.Fields)));
    const patternInput = refOrInline(ctx, fullName(t), JsonSchemaValue_SVDict(recordSchema(rp)), childDefs);
    return new Plan((v) => (b.IsMap(v) ? decodeRecordWith(b, rp, (key) => mapLookup(b, v, key)) : leafError(expected)), (v_1) => encodeRecordInto(b, rp, b.NewMap(), v_1), patternInput[0], patternInput[1]);
}
function buildCasePlans(ctx, t) {
    const inner = new BuildCtx(ctx.Backend, ctx.Registry, ctx.KeyTransform, ctx.TagTransform, cons(fullName(t), ctx.Building), ctx.RefMode);
    return map$2((caseInfo) => {
        const caseFields = getUnionCaseFields(caseInfo);
        let payload;
        const matchValue = caseFields.length | 0;
        switch (matchValue) {
            case 0: {
                payload = undefined;
                break;
            }
            case 1: {
                const payloadType = item(0, caseFields)[1];
                if (isRecord(payloadType)) {
                    payload = buildRecordPlan(inner, payloadType);
                }
                else {
                    const arg = name(caseInfo);
                    const arg_1 = name(payloadType);
                    const arg_2 = name(t);
                    payload = toFail(printf("union case %s has a non-record payload (%s); not supported in v1 — register an IJsonCodec for %s instead"))(arg)(arg_1)(arg_2);
                }
                break;
            }
            default: {
                const arg_3 = name(caseInfo);
                payload = toFail(printf("union case %s has %d positional fields; multi-field cases are not supported in v1"))(arg_3)(matchValue);
            }
        }
        return new CasePlan(ctx.TagTransform(name(caseInfo)), caseInfo, payload);
    }, getUnionCases(t));
}
/**
 * Decode-side view: wire tag -> case.
 */
function casesByTag(cases) {
    return ofArray(map$2((c) => [c.Tag, c], cases), {
        Compare: (x, y) => (comparePrimitives(x, y) | 0),
    });
}
function decodeUnionWith(b, cases, typeName, lookup) {
    let tagValue = undefined;
    const matchValue = lookup(discriminatorKey);
    if (matchValue != null) {
        if ((tagValue = value(matchValue), b.IsString(tagValue))) {
            const tagValue_1 = value(matchValue);
            const tag = b.AsString(tagValue_1);
            const matchValue_1 = tryFind(tag, cases);
            if (matchValue_1 != null) {
                const c = value(matchValue_1);
                const matchValue_2 = c.Payload;
                if (matchValue_2 != null) {
                    return Result_Map((payload) => makeUnion(c.Info, [payload]), decodeRecordWith(b, value(matchValue_2), lookup));
                }
                else {
                    return FSharpResult$2_Ok(makeUnion(c.Info, []));
                }
            }
            else {
                return FSharpResult$2_Error$(singleton$1(new FieldError(discriminatorKey, toText(printf("no case in %s matches discriminator value \'%s\'"))(typeName)(tag))));
            }
        }
        else {
            return FSharpResult$2_Error$(singleton$1(new FieldError(discriminatorKey, toText(printf("discriminator \'%s\' must be a string"))(discriminatorKey))));
        }
    }
    else {
        return FSharpResult$2_Error$(singleton$1(new FieldError(discriminatorKey, toText(printf("missing discriminator \'%s\' for %s"))(discriminatorKey)(typeName))));
    }
}
/**
 * Encode-side view: the value's runtime case tag indexes straight into the
 * same array decode was built from.
 *
 * `caseValues : obj[]` has a different runtime shape per backend — a
 * process-dict ref on BEAM, a GenericArray on Python, a native array on .NET —
 * so payload access goes through `ArrayLength` / `ArrayAt`.
 */
function encodeUnionWith(b, byTag, t, v) {
    const patternInput = getUnionFields(v, t);
    const c = item(patternInput[0].tag, byTag);
    const acc = b.Put(b.NewMap(), discriminatorKey, c.Tag);
    const matchValue = c.Payload;
    if (matchValue != null) {
        return encodeRecordInto(b, value(matchValue), acc, b.ArrayAt(patternInput[1], 0));
    }
    else {
        return acc;
    }
}
function planUnion(ctx, t) {
    const b = ctx.Backend;
    const cases = buildCasePlans(ctx, t);
    const byTag = casesByTag(cases);
    const byIndex = sortBy((c) => (c.Info.tag | 0), cases, {
        Compare: (x, y) => (comparePrimitives(x, y) | 0),
    });
    const typeName = name(t);
    const expected = toText(printf("expected JSON object for %s"))(typeName);
    const childDefs = mergeDefs(toList$1(delay(() => collect((c_2) => {
        const matchValue_3 = c_2.Payload;
        if (matchValue_3 == null) {
            return empty$2();
        }
        else {
            return ofArray$1(map$2((f) => f.Inner.Definitions, value(matchValue_3).Fields));
        }
    }, byIndex))));
    const body = JsonSchemaValue_SVDict(ofList(ofArray$1([["title", JsonSchemaValue_SVStr(typeName)], ["oneOf", JsonSchemaValue_SVList(toList$1(delay(() => map$1((c_3) => {
                const c_1 = c_3;
                const discriminator = ofList(singleton$1([discriminatorKey, JsonSchemaValue_SVDict(ofList(singleton$1(["const", JsonSchemaValue_SVStr(c_1.Tag)]), {
                        Compare: (x_1, y_1) => (comparePrimitives(x_1, y_1) | 0),
                    }))]), {
                    Compare: (x_2, y_2) => (comparePrimitives(x_2, y_2) | 0),
                });
                const matchValue = c_1.Payload;
                if (matchValue != null) {
                    const payload = recordSchema(value(matchValue));
                    let properties;
                    const matchValue_1 = tryFind("properties", payload);
                    let matchResult = undefined, p = undefined;
                    if (matchValue_1 != null) {
                        if (value(matchValue_1).tag === /* SVDict */ 5) {
                            matchResult = 0;
                            p = value(matchValue_1).fields[0];
                        }
                        else {
                            matchResult = 1;
                        }
                    }
                    else {
                        matchResult = 1;
                    }
                    switch (matchResult) {
                        case 0: {
                            properties = fold((acc, k, v) => add(k, v, acc), discriminator, p);
                            break;
                        }
                        default:
                            properties = discriminator;
                    }
                    let required;
                    const matchValue_2 = tryFind("required", payload);
                    let matchResult_1 = undefined, r = undefined;
                    if (matchValue_2 != null) {
                        if (value(matchValue_2).tag === /* SVList */ 4) {
                            matchResult_1 = 0;
                            r = value(matchValue_2).fields[0];
                        }
                        else {
                            matchResult_1 = 1;
                        }
                    }
                    else {
                        matchResult_1 = 1;
                    }
                    switch (matchResult_1) {
                        case 0: {
                            required = cons(JsonSchemaValue_SVStr(discriminatorKey), r);
                            break;
                        }
                        default:
                            required = singleton$1(JsonSchemaValue_SVStr(discriminatorKey));
                    }
                    return JsonSchemaValue_SVDict(ofList(ofArray$1([["type", JsonSchemaValue_SVStr("object")], ["title", JsonSchemaValue_SVStr(name(c_1.Info))], ["properties", JsonSchemaValue_SVDict(properties)], ["required", JsonSchemaValue_SVList(required)]]), {
                        Compare: (x_4, y_4) => (comparePrimitives(x_4, y_4) | 0),
                    }));
                }
                else {
                    return JsonSchemaValue_SVDict(ofList(ofArray$1([["type", JsonSchemaValue_SVStr("object")], ["title", JsonSchemaValue_SVStr(name(c_1.Info))], ["properties", JsonSchemaValue_SVDict(discriminator)], ["required", JsonSchemaValue_SVList(singleton$1(JsonSchemaValue_SVStr(discriminatorKey)))]]), {
                        Compare: (x_3, y_3) => (comparePrimitives(x_3, y_3) | 0),
                    }));
                }
            }, byIndex))))]]), {
        Compare: (x_5, y_5) => (comparePrimitives(x_5, y_5) | 0),
    }));
    const patternInput = refOrInline(ctx, fullName(t), body, childDefs);
    return new Plan((v_1) => (b.IsMap(v_1) ? decodeUnionWith(b, byTag, typeName, (key) => mapLookup(b, v_1, key)) : leafError(expected)), (v_2) => encodeUnionWith(b, byIndex, t, v_2), patternInput[0], patternInput[1]);
}
function planDeferred(ctx, t) {
    let matchValue = undefined;
    const restart = new BuildCtx(ctx.Backend, ctx.Registry, ctx.KeyTransform, ctx.TagTransform, empty$1(), ctx.RefMode);
    return new Plan((v) => forTypeIn(restart, t).Decode(v), (v_1) => forTypeIn(restart, t).Encode(v_1), (matchValue = ctx.RefMode, (matchValue == null) ? JsonSchemaValue_SVDict(ofList(ofArray$1([["type", JsonSchemaValue_SVStr("object")], ["title", JsonSchemaValue_SVStr(name(t))]]), {
        Compare: (x_1, y_1) => (comparePrimitives(x_1, y_1) | 0),
    })) : JsonSchemaValue_SVDict(ofList(singleton$1(["$ref", JsonSchemaValue_SVStr(value(matchValue) + fullName(t))]), {
        Compare: (x, y) => (comparePrimitives(x, y) | 0),
    }))), noDefs);
}
function forType(backend, registry, keyTransform, tagTransform, t) {
    return forTypeIn(new BuildCtx(backend, registry, keyTransform, tagTransform, empty$1(), undefined), t);
}
function forTypeFromLookup(backend, registry, keyTransform, tagTransform, t) {
    const ctx = new BuildCtx(backend, registry, keyTransform, tagTransform, empty$1(), undefined);
    const fullName$1 = fullName(t);
    const keyless = () => {
        let arg = undefined;
        const err = singleton$1(new FieldError("", (arg = name(t), toText(printf("auto<%s> requires a record or discriminated-union type"))(arg))));
        return (_arg) => FSharpResult$2_Error$(err);
    };
    if (isFSharpListType(fullName$1) ? true : isArray(t)) {
        return keyless();
    }
    else if (isRecord(t) ? true : isUnion(t)) {
        const matchValue = tryGetCodecEntry(fullName$1, registry);
        if (matchValue == null) {
            if (isRecord(t)) {
                const rp = buildRecordPlan(ctx, t);
                return (src_1) => decodeRecordWith(backend, rp, src_1.Get);
            }
            else {
                const cases = casesByTag(buildCasePlans(ctx, t));
                const typeName = name(t);
                return (src_2) => decodeUnionWith(backend, cases, typeName, src_2.Get);
            }
        }
        else {
            const entry = value(matchValue);
            return (src) => {
                const matchValue_1 = entry.decode(toJsonValue(backend, src.AsMap()));
                return (matchValue_1.tag === /* Error */ 1) ? leafError(matchValue_1.fields[0]) : FSharpResult$2_Ok(matchValue_1.fields[0]);
            };
        }
    }
    else {
        return keyless();
    }
}

function separateUpper(separator, name) {
    let result = "";
    for (let i = 0; i <= (name.length - 1); i++) {
        const c = name[i];
        if (isUpper(c)) {
            if (i > 0) {
                result = (result + separator);
            }
            result = (result + c.toLowerCase());
        }
        else {
            result = (result + c);
        }
    }
    return result;
}
function toSnakeCase(name) {
    return separateUpper("_", name);
}
function dashify(separator, name) {
    return separateUpper(separator, name);
}
/**
 * Apply a case rule to a field name.
 * Reflection reports the F# spelling (`AirTemperature`) on every target, but
 * the rule still normalizes to a canonical PascalCase form before emitting the
 * requested casing — so it produces the same output whether it is handed an F#
 * field name, a snake_case name, or a name already in the target casing.
 * BEAM reflection reported snake_case before Fable 5.8.1
 * (fable-compiler/Fable#4766); the normalization keeps that input working too.
 */
function applyCaseRule(caseRule, name) {
    if (caseRule === 0) {
        return name;
    }
    else {
        const pascal = toCanonicalPascal(name);
        switch (caseRule) {
            case 1:
                return lowerFirst(pascal);
            case 2:
                return toSnakeCase(pascal);
            case 3:
                return toSnakeCase(pascal).toUpperCase();
            case 4:
                return dashify("-", pascal);
            case 5:
                return pascal;
            default:
                return pascal;
        }
    }
}
class TypedJson$1 extends Record {
    decode;
    encode;
    decodeWith;
    encodeWith;
    decodeStringMap;
    caseRules;
    aliases;
    withCaseRules;
    withAliases;
    constructor(decode, encode, decodeWith, encodeWith, decodeStringMap, caseRules, aliases, withCaseRules, withAliases) {
        super();
        this.decode = decode;
        this.encode = encode;
        this.decodeWith = decodeWith;
        this.encodeWith = encodeWith;
        this.decodeStringMap = decodeStringMap;
        this.caseRules = caseRules;
        this.aliases = aliases;
        this.withCaseRules = withCaseRules;
        this.withAliases = withAliases;
    }
}
/**
 * Serialize a backend-native value (map, list, primitive) to a JSON string.
 */
function Encode_toJson(backend, term) {
    return backend.Stringify(term);
}
/**
 * Resolve the JSON key for a given F# field name: alias if present,
 * otherwise the case-rule-derived form. Lookup is keyed by the field's
 * PascalCase form so the same alias works regardless of how the
 * backend's reflection presents the name (BEAM lowercases, Python
 * preserves the F# spelling).
 */
function resolveKey(aliases, caseRules, fieldName) {
    const matchValue = tryFind(applyCaseRule(5, fieldName), aliases);
    if (matchValue == null) {
        return applyCaseRule(caseRules, fieldName);
    }
    else {
        return value(matchValue);
    }
}
function buildCodec(backend, registry, typ) {
    const build = (aliases, caseRules) => {
        const defaultKeyTransform = (fieldName) => resolveKey(aliases, caseRules, fieldName);
        const defaultTagTransform = (name) => applyCaseRule(caseRules, name);
        const defaultPlan = forType(backend, registry, defaultKeyTransform, defaultTagTransform, typ);
        const defaultLookupDecode = forTypeFromLookup(backend, registry, defaultKeyTransform, defaultTagTransform, typ);
        const decodeWith = (rules, map_1) => Result_Map((value_1) => value_1, ((rules === caseRules) ? defaultPlan : forType(backend, registry, (fieldName_1) => resolveKey(aliases, rules, fieldName_1), (name_1) => applyCaseRule(rules, name_1), typ)).Decode(map_1));
        const encodeWith = (rules_1, record) => Encode_toJson(backend, ((rules_1 === caseRules) ? defaultPlan : forType(backend, registry, (fieldName_2) => resolveKey(aliases, rules_1, fieldName_2), (name_2) => applyCaseRule(rules_1, name_2), typ)).Encode(record));
        return new TypedJson$1(curry2(decodeWith)(caseRules), curry2(encodeWith)(caseRules), decodeWith, encodeWith, (map) => Result_Map((value) => value, defaultLookupDecode(stringMapSource(backend, map))), caseRules, aliases, (newRules) => build(aliases, newRules), (newAliases) => build(newAliases, caseRules));
    };
    return build(empty({
        Compare: (x, y) => (comparePrimitives(x, y) | 0),
    }), 1);
}

class JSBackendImpl {
    constructor() {
    }
    NewMap() {
        return {};
    }
    ContainsKey(map, key) {
        return key in map;
    }
    Get(map, key) {
        return map[key];
    }
    Put(map, key, value) {
        return (map[key] = value, map);
    }
    ParseRaw(json) {
        return JSON.parse(json);
    }
    Stringify(value) {
        return JSON.stringify(value);
    }
    IsString(value) {
        return (typeof value) === "string";
    }
    IsInt(value) {
        return ((typeof value) === "number") && (Number.isInteger(value));
    }
    IsFloat(value) {
        return ((typeof value) === "number") && !(Number.isInteger(value));
    }
    IsBool(value) {
        return (typeof value) === "boolean";
    }
    IsNull(value) {
        return Operators_IsNull(value);
    }
    IsArray(value) {
        return Array.isArray(value);
    }
    IsMap(value) {
        return (((typeof value) === "object") && !Operators_IsNull(value)) && !Array.isArray(value);
    }
    AsString(value) {
        return value;
    }
    AsInt(value) {
        return value | 0;
    }
    AsFloat(value) {
        return value;
    }
    AsBool(value) {
        return value;
    }
    ArrayLength(arr) {
        return arr.length | 0;
    }
    ArrayAt(arr, i) {
        return arr[i];
    }
    BuildArray(items) {
        return toArray(items);
    }
    get Null() {
        return defaultOf();
    }
}
function JSBackendImpl_$ctor() {
    return new JSBackendImpl();
}
const js$1 = JSBackendImpl_$ctor();

const js = js$1;

const runnerResult = buildCodec(js, emptyRegistry, RunnerResult_$reflection());
function encodeResult(value) {
    return runnerResult.encode(value);
}

function execFile(file, args, options) {
    return new Promise((resolve, reject) => {
        execFile$1(file, args, options, ((error, stdout, stderr) => {
            if (Operators_IsNull(error)) {
                resolve([stdout, stderr]);
            }
            else {
                reject(new Exception(isNullOrWhiteSpace(stderr) ? error.message : stderr));
            }
        }));
    });
}

function tryGetValue(map, key, defaultValue) {
    if (map.has(key)) {
        defaultValue.contents = map.get(key);
        return true;
    }
    return false;
}
function addToSet(v, set) {
    if (set.has(v)) {
        return false;
    }
    set.add(v);
    return true;
}
function getItemFromDict(map, key) {
    if (map.has(key)) {
        return map.get(key);
    }
    else {
        throw new Exception(`The given key '${key}' was not present in the dictionary.`);
    }
}

class HashSet {
    comparer;
    hashMap;
    "init@9";
    constructor(items, comparer) {
        const this$ = new FSharpRef(defaultOf());
        this.comparer = comparer;
        this$.contents = this;
        this.hashMap = (new Map([]));
        this["init@9"] = 1;
        const enumerator = getEnumerator(items);
        try {
            while (enumerator["System.Collections.IEnumerator.MoveNext"]()) {
                const item = enumerator["System.Collections.Generic.IEnumerator`1.get_Current"]();
                HashSet__Add_2B595(this$.contents, item);
            }
        }
        finally {
            disposeSafe(enumerator);
        }
    }
    get [Symbol.toStringTag]() {
        return "HashSet";
    }
    toJSON() {
        const this$ = this;
        return Array.from(this$);
    }
    "System.Collections.IEnumerable.GetEnumerator"() {
        const this$ = this;
        return getEnumerator(this$);
    }
    GetEnumerator() {
        const this$ = this;
        return getEnumerator(concat(this$.hashMap.values()));
    }
    [Symbol.iterator]() {
        return toIterator(getEnumerator(this));
    }
    "System.Collections.Generic.ICollection`1.Add2B595"(item) {
        const this$ = this;
        HashSet__Add_2B595(this$, item);
    }
    "System.Collections.Generic.ICollection`1.Clear"() {
        const this$ = this;
        HashSet__Clear(this$);
    }
    "System.Collections.Generic.ICollection`1.Contains2B595"(item) {
        const this$ = this;
        return HashSet__Contains_2B595(this$, item);
    }
    "System.Collections.Generic.ICollection`1.CopyToZ3B4C077E"(array, arrayIndex) {
        const this$ = this;
        iterateIndexed((i, e) => {
            setItem(array, arrayIndex + i, e);
        }, this$);
    }
    "System.Collections.Generic.ICollection`1.get_Count"() {
        const this$ = this;
        return HashSet__get_Count(this$) | 0;
    }
    "System.Collections.Generic.ICollection`1.get_IsReadOnly"() {
        return false;
    }
    "System.Collections.Generic.ICollection`1.Remove2B595"(item) {
        const this$ = this;
        return HashSet__Remove_2B595(this$, item);
    }
    get size() {
        const this$ = this;
        return HashSet__get_Count(this$) | 0;
    }
    add(k) {
        const this$ = this;
        HashSet__Add_2B595(this$, k);
        return this$;
    }
    clear() {
        const this$ = this;
        HashSet__Clear(this$);
    }
    delete(k) {
        const this$ = this;
        return HashSet__Remove_2B595(this$, k);
    }
    has(k) {
        const this$ = this;
        return HashSet__Contains_2B595(this$, k);
    }
    keys() {
        const this$ = this;
        return map$1((x) => x, this$);
    }
    values() {
        const this$ = this;
        return map$1((x) => x, this$);
    }
    entries() {
        const this$ = this;
        return map$1((v) => [v, v], this$);
    }
    forEach(f, thisArg) {
        const this$ = this;
        iterate((x) => {
            f(x, x, this$);
        }, this$);
    }
}
function HashSet__TryFindIndex_2B595(this$, k) {
    const h = this$.comparer.GetHashCode(k) | 0;
    let matchValue;
    let outArg = defaultOf();
    matchValue = [tryGetValue(this$.hashMap, h, new FSharpRef(() => outArg, (v) => {
            outArg = v;
        })), outArg];
    if (matchValue[0]) {
        return [true, h, matchValue[1].findIndex((v_1) => this$.comparer.Equals(k, v_1))];
    }
    else {
        return [false, h, -1];
    }
}
function HashSet__Clear(this$) {
    this$.hashMap.clear();
}
function HashSet__get_Count(this$) {
    let count = 0;
    let enumerator = getEnumerator(this$.hashMap.values());
    try {
        while (enumerator["System.Collections.IEnumerator.MoveNext"]()) {
            const items = enumerator["System.Collections.Generic.IEnumerator`1.get_Current"]();
            count = ((count + items.length) | 0);
        }
    }
    finally {
        disposeSafe(enumerator);
    }
    return count | 0;
}
function HashSet__Add_2B595(this$, k) {
    const matchValue = HashSet__TryFindIndex_2B595(this$, k);
    if (matchValue[0]) {
        if (matchValue[2] > -1) {
            return false;
        }
        else {
            void (getItemFromDict(this$.hashMap, matchValue[1]).push(k));
            return true;
        }
    }
    else {
        this$.hashMap.set(matchValue[1], [k]);
        return true;
    }
}
function HashSet__Contains_2B595(this$, k) {
    const matchValue = HashSet__TryFindIndex_2B595(this$, k);
    let matchResult = undefined;
    if (matchValue[0]) {
        if (matchValue[2] > -1) {
            matchResult = 0;
        }
        else {
            matchResult = 1;
        }
    }
    else {
        matchResult = 1;
    }
    switch (matchResult) {
        case 0:
            return true;
        default:
            return false;
    }
}
function HashSet__Remove_2B595(this$, k) {
    const matchValue = HashSet__TryFindIndex_2B595(this$, k);
    let matchResult = undefined;
    if (matchValue[0]) {
        if (matchValue[2] > -1) {
            matchResult = 0;
        }
        else {
            matchResult = 1;
        }
    }
    else {
        matchResult = 1;
    }
    switch (matchResult) {
        case 0: {
            getItemFromDict(this$.hashMap, matchValue[1]).splice(matchValue[2], 1);
            return true;
        }
        default:
            return false;
    }
}

class SetTreeLeaf$1 {
    k;
    constructor(k) {
        this.k = k;
    }
}
function SetTreeLeaf$1_$ctor_2B595(k) {
    return new SetTreeLeaf$1(k);
}
function SetTreeLeaf$1__get_Key(_) {
    return _.k;
}
class SetTreeNode$1 extends SetTreeLeaf$1 {
    right;
    left;
    h;
    constructor(v, left, right, h) {
        super(v);
        this.left = left;
        this.right = right;
        this.h = (h | 0);
    }
}
function SetTreeNode$1_$ctor_5F465FC9(v, left, right, h) {
    return new SetTreeNode$1(v, left, right, h);
}
function SetTreeNode$1__get_Left(_) {
    return _.left;
}
function SetTreeNode$1__get_Right(_) {
    return _.right;
}
function SetTreeNode$1__get_Height(_) {
    return _.h | 0;
}
function SetTreeModule_empty() {
    return undefined;
}
function SetTreeModule_countAux(t_mut, acc_mut) {
    SetTreeModule_countAux: while (true) {
        const t = t_mut, acc = acc_mut;
        if (t != null) {
            const t2 = value(t);
            if (t2 instanceof SetTreeNode$1) {
                const tn = t2;
                t_mut = SetTreeNode$1__get_Left(tn);
                acc_mut = SetTreeModule_countAux(SetTreeNode$1__get_Right(tn), acc + 1);
                continue SetTreeModule_countAux;
            }
            else {
                return (acc + 1) | 0;
            }
        }
        else {
            return acc | 0;
        }
    }
}
function SetTreeModule_count(s) {
    return SetTreeModule_countAux(s, 0) | 0;
}
function SetTreeModule_mk(l, k, r) {
    let tn = undefined, tn_1 = undefined;
    let hl;
    const t = l;
    if (t != null) {
        const t2 = value(t);
        hl = ((t2 instanceof SetTreeNode$1) ? ((tn = t2, SetTreeNode$1__get_Height(tn))) : 1);
    }
    else {
        hl = 0;
    }
    let hr;
    const t_1 = r;
    if (t_1 != null) {
        const t2_1 = value(t_1);
        hr = ((t2_1 instanceof SetTreeNode$1) ? ((tn_1 = t2_1, SetTreeNode$1__get_Height(tn_1))) : 1);
    }
    else {
        hr = 0;
    }
    const m = ((hl < hr) ? hr : hl) | 0;
    if (m === 0) {
        return SetTreeLeaf$1_$ctor_2B595(k);
    }
    else {
        return SetTreeNode$1_$ctor_5F465FC9(k, l, r, m + 1);
    }
}
function SetTreeModule_rebalance(t1, v, t2) {
    let tn = undefined, tn_1 = undefined, t_2 = undefined, t2_3 = undefined, tn_2 = undefined, t_3 = undefined, t2_4 = undefined, tn_3 = undefined;
    let t1h;
    const t = t1;
    if (t != null) {
        const t2_1 = value(t);
        t1h = ((t2_1 instanceof SetTreeNode$1) ? ((tn = t2_1, SetTreeNode$1__get_Height(tn))) : 1);
    }
    else {
        t1h = 0;
    }
    let t2h;
    const t_1 = t2;
    if (t_1 != null) {
        const t2_2 = value(t_1);
        t2h = ((t2_2 instanceof SetTreeNode$1) ? ((tn_1 = t2_2, SetTreeNode$1__get_Height(tn_1))) : 1);
    }
    else {
        t2h = 0;
    }
    if (t2h > (t1h + 2)) {
        const matchValue = value(t2);
        if (matchValue instanceof SetTreeNode$1) {
            const t2$0027 = matchValue;
            if (((t_2 = SetTreeNode$1__get_Left(t2$0027), (t_2 != null) ? ((t2_3 = value(t_2), (t2_3 instanceof SetTreeNode$1) ? ((tn_2 = t2_3, SetTreeNode$1__get_Height(tn_2))) : 1)) : 0)) > (t1h + 1)) {
                const matchValue_1 = value(SetTreeNode$1__get_Left(t2$0027));
                if (matchValue_1 instanceof SetTreeNode$1) {
                    const t2l = matchValue_1;
                    return SetTreeModule_mk(SetTreeModule_mk(t1, v, SetTreeNode$1__get_Left(t2l)), SetTreeLeaf$1__get_Key(t2l), SetTreeModule_mk(SetTreeNode$1__get_Right(t2l), SetTreeLeaf$1__get_Key(t2$0027), SetTreeNode$1__get_Right(t2$0027)));
                }
                else {
                    throw new Exception("internal error: Set.rebalance");
                }
            }
            else {
                return SetTreeModule_mk(SetTreeModule_mk(t1, v, SetTreeNode$1__get_Left(t2$0027)), SetTreeLeaf$1__get_Key(t2$0027), SetTreeNode$1__get_Right(t2$0027));
            }
        }
        else {
            throw new Exception("internal error: Set.rebalance");
        }
    }
    else if (t1h > (t2h + 2)) {
        const matchValue_2 = value(t1);
        if (matchValue_2 instanceof SetTreeNode$1) {
            const t1$0027 = matchValue_2;
            if (((t_3 = SetTreeNode$1__get_Right(t1$0027), (t_3 != null) ? ((t2_4 = value(t_3), (t2_4 instanceof SetTreeNode$1) ? ((tn_3 = t2_4, SetTreeNode$1__get_Height(tn_3))) : 1)) : 0)) > (t2h + 1)) {
                const matchValue_3 = value(SetTreeNode$1__get_Right(t1$0027));
                if (matchValue_3 instanceof SetTreeNode$1) {
                    const t1r = matchValue_3;
                    return SetTreeModule_mk(SetTreeModule_mk(SetTreeNode$1__get_Left(t1$0027), SetTreeLeaf$1__get_Key(t1$0027), SetTreeNode$1__get_Left(t1r)), SetTreeLeaf$1__get_Key(t1r), SetTreeModule_mk(SetTreeNode$1__get_Right(t1r), v, t2));
                }
                else {
                    throw new Exception("internal error: Set.rebalance");
                }
            }
            else {
                return SetTreeModule_mk(SetTreeNode$1__get_Left(t1$0027), SetTreeLeaf$1__get_Key(t1$0027), SetTreeModule_mk(SetTreeNode$1__get_Right(t1$0027), v, t2));
            }
        }
        else {
            throw new Exception("internal error: Set.rebalance");
        }
    }
    else {
        return SetTreeModule_mk(t1, v, t2);
    }
}
function SetTreeModule_add(comparer, k, t) {
    if (t != null) {
        const t2 = value(t);
        const c = comparer.Compare(k, SetTreeLeaf$1__get_Key(t2)) | 0;
        if (t2 instanceof SetTreeNode$1) {
            const tn = t2;
            if (c < 0) {
                return SetTreeModule_rebalance(SetTreeModule_add(comparer, k, SetTreeNode$1__get_Left(tn)), SetTreeLeaf$1__get_Key(tn), SetTreeNode$1__get_Right(tn));
            }
            else if (c === 0) {
                return t;
            }
            else {
                return SetTreeModule_rebalance(SetTreeNode$1__get_Left(tn), SetTreeLeaf$1__get_Key(tn), SetTreeModule_add(comparer, k, SetTreeNode$1__get_Right(tn)));
            }
        }
        else {
            const c_1 = comparer.Compare(k, SetTreeLeaf$1__get_Key(t2)) | 0;
            if (c_1 < 0) {
                return SetTreeNode$1_$ctor_5F465FC9(k, SetTreeModule_empty(), t, 2);
            }
            else if (c_1 === 0) {
                return t;
            }
            else {
                return SetTreeNode$1_$ctor_5F465FC9(k, t, SetTreeModule_empty(), 2);
            }
        }
    }
    else {
        return SetTreeLeaf$1_$ctor_2B595(k);
    }
}
function SetTreeModule_mem(comparer_mut, k_mut, t_mut) {
    SetTreeModule_mem: while (true) {
        const comparer = comparer_mut, k = k_mut, t = t_mut;
        if (t != null) {
            const t2 = value(t);
            const c = comparer.Compare(k, SetTreeLeaf$1__get_Key(t2)) | 0;
            if (t2 instanceof SetTreeNode$1) {
                const tn = t2;
                if (c < 0) {
                    comparer_mut = comparer;
                    k_mut = k;
                    t_mut = SetTreeNode$1__get_Left(tn);
                    continue SetTreeModule_mem;
                }
                else if (c === 0) {
                    return true;
                }
                else {
                    comparer_mut = comparer;
                    k_mut = k;
                    t_mut = SetTreeNode$1__get_Right(tn);
                    continue SetTreeModule_mem;
                }
            }
            else {
                return c === 0;
            }
        }
        else {
            return false;
        }
    }
}
function SetTreeModule_iter(f_mut, t_mut) {
    SetTreeModule_iter: while (true) {
        const f = f_mut, t = t_mut;
        if (t != null) {
            const t2 = value(t);
            if (t2 instanceof SetTreeNode$1) {
                const tn = t2;
                SetTreeModule_iter(f, SetTreeNode$1__get_Left(tn));
                f(SetTreeLeaf$1__get_Key(tn));
                f_mut = f;
                t_mut = SetTreeNode$1__get_Right(tn);
                continue SetTreeModule_iter;
            }
            else {
                f(SetTreeLeaf$1__get_Key(t2));
            }
        }
        break;
    }
}
class SetTreeModule_SetIterator$1 extends Record {
    stack;
    started;
    constructor(stack, started) {
        super();
        this.stack = stack;
        this.started = started;
    }
}
function SetTreeModule_collapseLHS(stack_mut) {
    SetTreeModule_collapseLHS: while (true) {
        const stack = stack_mut;
        if (!isEmpty(stack)) {
            const x = head(stack);
            const rest = tail(stack);
            if (x != null) {
                const x2 = value(x);
                if (x2 instanceof SetTreeNode$1) {
                    const xn = x2;
                    stack_mut = ofArrayWithTail([SetTreeNode$1__get_Left(xn), SetTreeLeaf$1_$ctor_2B595(SetTreeLeaf$1__get_Key(xn)), SetTreeNode$1__get_Right(xn)], rest);
                    continue SetTreeModule_collapseLHS;
                }
                else {
                    return stack;
                }
            }
            else {
                stack_mut = rest;
                continue SetTreeModule_collapseLHS;
            }
        }
        else {
            return empty$1();
        }
    }
}
function SetTreeModule_mkIterator(s) {
    return new SetTreeModule_SetIterator$1(SetTreeModule_collapseLHS(singleton$1(s)), false);
}
function SetTreeModule_notStarted() {
    throw new Exception("Enumeration not started");
}
function SetTreeModule_alreadyFinished() {
    throw new Exception("Enumeration already started");
}
function SetTreeModule_current(i) {
    if (i.started) {
        const matchValue = i.stack;
        if (isEmpty(matchValue)) {
            return SetTreeModule_alreadyFinished();
        }
        else if (head(matchValue) != null) {
            const t = value(head(matchValue));
            return SetTreeLeaf$1__get_Key(t);
        }
        else {
            throw new Exception("Please report error: Set iterator, unexpected stack for current");
        }
    }
    else {
        return SetTreeModule_notStarted();
    }
}
function SetTreeModule_moveNext(i) {
    if (i.started) {
        const matchValue = i.stack;
        if (!isEmpty(matchValue)) {
            if (head(matchValue) != null) {
                const t = value(head(matchValue));
                if (t instanceof SetTreeNode$1) {
                    throw new Exception("Please report error: Set iterator, unexpected stack for moveNext");
                }
                else {
                    i.stack = SetTreeModule_collapseLHS(tail(matchValue));
                    return !isEmpty(i.stack);
                }
            }
            else {
                throw new Exception("Please report error: Set iterator, unexpected stack for moveNext");
            }
        }
        else {
            return false;
        }
    }
    else {
        i.started = true;
        return !isEmpty(i.stack);
    }
}
function SetTreeModule_mkIEnumerator(s) {
    let i = SetTreeModule_mkIterator(s);
    return {
        "System.Collections.Generic.IEnumerator`1.get_Current"() {
            return SetTreeModule_current(i);
        },
        "System.Collections.IEnumerator.get_Current"() {
            return SetTreeModule_current(i);
        },
        "System.Collections.IEnumerator.MoveNext"() {
            return SetTreeModule_moveNext(i);
        },
        "System.Collections.IEnumerator.Reset"() {
            i = SetTreeModule_mkIterator(s);
        },
        Dispose() {
        },
    };
}
/**
 * Set comparison.  Note this can be expensive.
 */
function SetTreeModule_compareStacks(comparer_mut, l1_mut, l2_mut) {
    SetTreeModule_compareStacks: while (true) {
        const comparer = comparer_mut, l1 = l1_mut, l2 = l2_mut;
        if (!isEmpty(l1)) {
            if (!isEmpty(l2)) {
                if (head(l2) != null) {
                    if (head(l1) != null) {
                        const x1_3 = value(head(l1));
                        const x2_3 = value(head(l2));
                        if (x1_3 instanceof SetTreeNode$1) {
                            const x1n_2 = x1_3;
                            if (SetTreeNode$1__get_Left(x1n_2) == null) {
                                if (x2_3 instanceof SetTreeNode$1) {
                                    const x2n_2 = x2_3;
                                    if (SetTreeNode$1__get_Left(x2n_2) == null) {
                                        const c = comparer.Compare(SetTreeLeaf$1__get_Key(x1n_2), SetTreeLeaf$1__get_Key(x2n_2)) | 0;
                                        if (c !== 0) {
                                            return c | 0;
                                        }
                                        else {
                                            comparer_mut = comparer;
                                            l1_mut = cons(SetTreeNode$1__get_Right(x1n_2), tail(l1));
                                            l2_mut = cons(SetTreeNode$1__get_Right(x2n_2), tail(l2));
                                            continue SetTreeModule_compareStacks;
                                        }
                                    }
                                    else {
                                        let matchResult = undefined, t1_6 = undefined, x1_4 = undefined, t2_6 = undefined, x2_4 = undefined;
                                        if (!isEmpty(l1)) {
                                            if (head(l1) != null) {
                                                matchResult = 0;
                                                t1_6 = tail(l1);
                                                x1_4 = value(head(l1));
                                            }
                                            else if (!isEmpty(l2)) {
                                                if (head(l2) != null) {
                                                    matchResult = 1;
                                                    t2_6 = tail(l2);
                                                    x2_4 = value(head(l2));
                                                }
                                                else {
                                                    matchResult = 2;
                                                }
                                            }
                                            else {
                                                matchResult = 2;
                                            }
                                        }
                                        else if (!isEmpty(l2)) {
                                            if (head(l2) != null) {
                                                matchResult = 1;
                                                t2_6 = tail(l2);
                                                x2_4 = value(head(l2));
                                            }
                                            else {
                                                matchResult = 2;
                                            }
                                        }
                                        else {
                                            matchResult = 2;
                                        }
                                        switch (matchResult) {
                                            case 0:
                                                if (x1_4 instanceof SetTreeNode$1) {
                                                    const x1n_3 = x1_4;
                                                    comparer_mut = comparer;
                                                    l1_mut = ofArrayWithTail([SetTreeNode$1__get_Left(x1n_3), SetTreeNode$1_$ctor_5F465FC9(SetTreeLeaf$1__get_Key(x1n_3), SetTreeModule_empty(), SetTreeNode$1__get_Right(x1n_3), 0)], t1_6);
                                                    l2_mut = l2;
                                                    continue SetTreeModule_compareStacks;
                                                }
                                                else {
                                                    comparer_mut = comparer;
                                                    l1_mut = ofArrayWithTail([SetTreeModule_empty(), SetTreeLeaf$1_$ctor_2B595(SetTreeLeaf$1__get_Key(x1_4))], t1_6);
                                                    l2_mut = l2;
                                                    continue SetTreeModule_compareStacks;
                                                }
                                            case 1:
                                                if (x2_4 instanceof SetTreeNode$1) {
                                                    const x2n_3 = x2_4;
                                                    comparer_mut = comparer;
                                                    l1_mut = l1;
                                                    l2_mut = ofArrayWithTail([SetTreeNode$1__get_Left(x2n_3), SetTreeNode$1_$ctor_5F465FC9(SetTreeLeaf$1__get_Key(x2n_3), SetTreeModule_empty(), SetTreeNode$1__get_Right(x2n_3), 0)], t2_6);
                                                    continue SetTreeModule_compareStacks;
                                                }
                                                else {
                                                    comparer_mut = comparer;
                                                    l1_mut = l1;
                                                    l2_mut = ofArrayWithTail([SetTreeModule_empty(), SetTreeLeaf$1_$ctor_2B595(SetTreeLeaf$1__get_Key(x2_4))], t2_6);
                                                    continue SetTreeModule_compareStacks;
                                                }
                                            default:
                                                throw new Exception("unexpected state in SetTree.compareStacks");
                                        }
                                    }
                                }
                                else {
                                    const c_1 = comparer.Compare(SetTreeLeaf$1__get_Key(x1n_2), SetTreeLeaf$1__get_Key(x2_3)) | 0;
                                    if (c_1 !== 0) {
                                        return c_1 | 0;
                                    }
                                    else {
                                        comparer_mut = comparer;
                                        l1_mut = cons(SetTreeNode$1__get_Right(x1n_2), tail(l1));
                                        l2_mut = cons(SetTreeModule_empty(), tail(l2));
                                        continue SetTreeModule_compareStacks;
                                    }
                                }
                            }
                            else {
                                let matchResult_1 = undefined, t1_7 = undefined, x1_5 = undefined, t2_7 = undefined, x2_5 = undefined;
                                if (!isEmpty(l1)) {
                                    if (head(l1) != null) {
                                        matchResult_1 = 0;
                                        t1_7 = tail(l1);
                                        x1_5 = value(head(l1));
                                    }
                                    else if (!isEmpty(l2)) {
                                        if (head(l2) != null) {
                                            matchResult_1 = 1;
                                            t2_7 = tail(l2);
                                            x2_5 = value(head(l2));
                                        }
                                        else {
                                            matchResult_1 = 2;
                                        }
                                    }
                                    else {
                                        matchResult_1 = 2;
                                    }
                                }
                                else if (!isEmpty(l2)) {
                                    if (head(l2) != null) {
                                        matchResult_1 = 1;
                                        t2_7 = tail(l2);
                                        x2_5 = value(head(l2));
                                    }
                                    else {
                                        matchResult_1 = 2;
                                    }
                                }
                                else {
                                    matchResult_1 = 2;
                                }
                                switch (matchResult_1) {
                                    case 0:
                                        if (x1_5 instanceof SetTreeNode$1) {
                                            const x1n_4 = x1_5;
                                            comparer_mut = comparer;
                                            l1_mut = ofArrayWithTail([SetTreeNode$1__get_Left(x1n_4), SetTreeNode$1_$ctor_5F465FC9(SetTreeLeaf$1__get_Key(x1n_4), SetTreeModule_empty(), SetTreeNode$1__get_Right(x1n_4), 0)], t1_7);
                                            l2_mut = l2;
                                            continue SetTreeModule_compareStacks;
                                        }
                                        else {
                                            comparer_mut = comparer;
                                            l1_mut = ofArrayWithTail([SetTreeModule_empty(), SetTreeLeaf$1_$ctor_2B595(SetTreeLeaf$1__get_Key(x1_5))], t1_7);
                                            l2_mut = l2;
                                            continue SetTreeModule_compareStacks;
                                        }
                                    case 1:
                                        if (x2_5 instanceof SetTreeNode$1) {
                                            const x2n_4 = x2_5;
                                            comparer_mut = comparer;
                                            l1_mut = l1;
                                            l2_mut = ofArrayWithTail([SetTreeNode$1__get_Left(x2n_4), SetTreeNode$1_$ctor_5F465FC9(SetTreeLeaf$1__get_Key(x2n_4), SetTreeModule_empty(), SetTreeNode$1__get_Right(x2n_4), 0)], t2_7);
                                            continue SetTreeModule_compareStacks;
                                        }
                                        else {
                                            comparer_mut = comparer;
                                            l1_mut = l1;
                                            l2_mut = ofArrayWithTail([SetTreeModule_empty(), SetTreeLeaf$1_$ctor_2B595(SetTreeLeaf$1__get_Key(x2_5))], t2_7);
                                            continue SetTreeModule_compareStacks;
                                        }
                                    default:
                                        throw new Exception("unexpected state in SetTree.compareStacks");
                                }
                            }
                        }
                        else if (x2_3 instanceof SetTreeNode$1) {
                            const x2n_5 = x2_3;
                            if (SetTreeNode$1__get_Left(x2n_5) == null) {
                                const c_2 = comparer.Compare(SetTreeLeaf$1__get_Key(x1_3), SetTreeLeaf$1__get_Key(x2n_5)) | 0;
                                if (c_2 !== 0) {
                                    return c_2 | 0;
                                }
                                else {
                                    comparer_mut = comparer;
                                    l1_mut = cons(SetTreeModule_empty(), tail(l1));
                                    l2_mut = cons(SetTreeNode$1__get_Right(x2n_5), tail(l2));
                                    continue SetTreeModule_compareStacks;
                                }
                            }
                            else {
                                let matchResult_2 = undefined, t1_8 = undefined, x1_6 = undefined, t2_8 = undefined, x2_6 = undefined;
                                if (!isEmpty(l1)) {
                                    if (head(l1) != null) {
                                        matchResult_2 = 0;
                                        t1_8 = tail(l1);
                                        x1_6 = value(head(l1));
                                    }
                                    else if (!isEmpty(l2)) {
                                        if (head(l2) != null) {
                                            matchResult_2 = 1;
                                            t2_8 = tail(l2);
                                            x2_6 = value(head(l2));
                                        }
                                        else {
                                            matchResult_2 = 2;
                                        }
                                    }
                                    else {
                                        matchResult_2 = 2;
                                    }
                                }
                                else if (!isEmpty(l2)) {
                                    if (head(l2) != null) {
                                        matchResult_2 = 1;
                                        t2_8 = tail(l2);
                                        x2_6 = value(head(l2));
                                    }
                                    else {
                                        matchResult_2 = 2;
                                    }
                                }
                                else {
                                    matchResult_2 = 2;
                                }
                                switch (matchResult_2) {
                                    case 0:
                                        if (x1_6 instanceof SetTreeNode$1) {
                                            const x1n_5 = x1_6;
                                            comparer_mut = comparer;
                                            l1_mut = ofArrayWithTail([SetTreeNode$1__get_Left(x1n_5), SetTreeNode$1_$ctor_5F465FC9(SetTreeLeaf$1__get_Key(x1n_5), SetTreeModule_empty(), SetTreeNode$1__get_Right(x1n_5), 0)], t1_8);
                                            l2_mut = l2;
                                            continue SetTreeModule_compareStacks;
                                        }
                                        else {
                                            comparer_mut = comparer;
                                            l1_mut = ofArrayWithTail([SetTreeModule_empty(), SetTreeLeaf$1_$ctor_2B595(SetTreeLeaf$1__get_Key(x1_6))], t1_8);
                                            l2_mut = l2;
                                            continue SetTreeModule_compareStacks;
                                        }
                                    case 1:
                                        if (x2_6 instanceof SetTreeNode$1) {
                                            const x2n_6 = x2_6;
                                            comparer_mut = comparer;
                                            l1_mut = l1;
                                            l2_mut = ofArrayWithTail([SetTreeNode$1__get_Left(x2n_6), SetTreeNode$1_$ctor_5F465FC9(SetTreeLeaf$1__get_Key(x2n_6), SetTreeModule_empty(), SetTreeNode$1__get_Right(x2n_6), 0)], t2_8);
                                            continue SetTreeModule_compareStacks;
                                        }
                                        else {
                                            comparer_mut = comparer;
                                            l1_mut = l1;
                                            l2_mut = ofArrayWithTail([SetTreeModule_empty(), SetTreeLeaf$1_$ctor_2B595(SetTreeLeaf$1__get_Key(x2_6))], t2_8);
                                            continue SetTreeModule_compareStacks;
                                        }
                                    default:
                                        throw new Exception("unexpected state in SetTree.compareStacks");
                                }
                            }
                        }
                        else {
                            const c_3 = comparer.Compare(SetTreeLeaf$1__get_Key(x1_3), SetTreeLeaf$1__get_Key(x2_3)) | 0;
                            if (c_3 !== 0) {
                                return c_3 | 0;
                            }
                            else {
                                comparer_mut = comparer;
                                l1_mut = tail(l1);
                                l2_mut = tail(l2);
                                continue SetTreeModule_compareStacks;
                            }
                        }
                    }
                    else {
                        value(head(l2));
                        let matchResult_3 = undefined, t1_2 = undefined, x1 = undefined, t2_2 = undefined, x2_1 = undefined;
                        if (!isEmpty(l1)) {
                            if (head(l1) != null) {
                                matchResult_3 = 0;
                                t1_2 = tail(l1);
                                x1 = value(head(l1));
                            }
                            else if (!isEmpty(l2)) {
                                if (head(l2) != null) {
                                    matchResult_3 = 1;
                                    t2_2 = tail(l2);
                                    x2_1 = value(head(l2));
                                }
                                else {
                                    matchResult_3 = 2;
                                }
                            }
                            else {
                                matchResult_3 = 2;
                            }
                        }
                        else if (!isEmpty(l2)) {
                            if (head(l2) != null) {
                                matchResult_3 = 1;
                                t2_2 = tail(l2);
                                x2_1 = value(head(l2));
                            }
                            else {
                                matchResult_3 = 2;
                            }
                        }
                        else {
                            matchResult_3 = 2;
                        }
                        switch (matchResult_3) {
                            case 0:
                                if (x1 instanceof SetTreeNode$1) {
                                    const x1n = x1;
                                    comparer_mut = comparer;
                                    l1_mut = ofArrayWithTail([SetTreeNode$1__get_Left(x1n), SetTreeNode$1_$ctor_5F465FC9(SetTreeLeaf$1__get_Key(x1n), SetTreeModule_empty(), SetTreeNode$1__get_Right(x1n), 0)], t1_2);
                                    l2_mut = l2;
                                    continue SetTreeModule_compareStacks;
                                }
                                else {
                                    comparer_mut = comparer;
                                    l1_mut = ofArrayWithTail([SetTreeModule_empty(), SetTreeLeaf$1_$ctor_2B595(SetTreeLeaf$1__get_Key(x1))], t1_2);
                                    l2_mut = l2;
                                    continue SetTreeModule_compareStacks;
                                }
                            case 1:
                                if (x2_1 instanceof SetTreeNode$1) {
                                    const x2n = x2_1;
                                    comparer_mut = comparer;
                                    l1_mut = l1;
                                    l2_mut = ofArrayWithTail([SetTreeNode$1__get_Left(x2n), SetTreeNode$1_$ctor_5F465FC9(SetTreeLeaf$1__get_Key(x2n), SetTreeModule_empty(), SetTreeNode$1__get_Right(x2n), 0)], t2_2);
                                    continue SetTreeModule_compareStacks;
                                }
                                else {
                                    comparer_mut = comparer;
                                    l1_mut = l1;
                                    l2_mut = ofArrayWithTail([SetTreeModule_empty(), SetTreeLeaf$1_$ctor_2B595(SetTreeLeaf$1__get_Key(x2_1))], t2_2);
                                    continue SetTreeModule_compareStacks;
                                }
                            default:
                                throw new Exception("unexpected state in SetTree.compareStacks");
                        }
                    }
                }
                else if (head(l1) != null) {
                    value(head(l1));
                    let matchResult_4 = undefined, t1_4 = undefined, x1_2 = undefined, t2_4 = undefined, x2_2 = undefined;
                    if (!isEmpty(l1)) {
                        if (head(l1) != null) {
                            matchResult_4 = 0;
                            t1_4 = tail(l1);
                            x1_2 = value(head(l1));
                        }
                        else if (!isEmpty(l2)) {
                            if (head(l2) != null) {
                                matchResult_4 = 1;
                                t2_4 = tail(l2);
                                x2_2 = value(head(l2));
                            }
                            else {
                                matchResult_4 = 2;
                            }
                        }
                        else {
                            matchResult_4 = 2;
                        }
                    }
                    else if (!isEmpty(l2)) {
                        if (head(l2) != null) {
                            matchResult_4 = 1;
                            t2_4 = tail(l2);
                            x2_2 = value(head(l2));
                        }
                        else {
                            matchResult_4 = 2;
                        }
                    }
                    else {
                        matchResult_4 = 2;
                    }
                    switch (matchResult_4) {
                        case 0:
                            if (x1_2 instanceof SetTreeNode$1) {
                                const x1n_1 = x1_2;
                                comparer_mut = comparer;
                                l1_mut = ofArrayWithTail([SetTreeNode$1__get_Left(x1n_1), SetTreeNode$1_$ctor_5F465FC9(SetTreeLeaf$1__get_Key(x1n_1), SetTreeModule_empty(), SetTreeNode$1__get_Right(x1n_1), 0)], t1_4);
                                l2_mut = l2;
                                continue SetTreeModule_compareStacks;
                            }
                            else {
                                comparer_mut = comparer;
                                l1_mut = ofArrayWithTail([SetTreeModule_empty(), SetTreeLeaf$1_$ctor_2B595(SetTreeLeaf$1__get_Key(x1_2))], t1_4);
                                l2_mut = l2;
                                continue SetTreeModule_compareStacks;
                            }
                        case 1:
                            if (x2_2 instanceof SetTreeNode$1) {
                                const x2n_1 = x2_2;
                                comparer_mut = comparer;
                                l1_mut = l1;
                                l2_mut = ofArrayWithTail([SetTreeNode$1__get_Left(x2n_1), SetTreeNode$1_$ctor_5F465FC9(SetTreeLeaf$1__get_Key(x2n_1), SetTreeModule_empty(), SetTreeNode$1__get_Right(x2n_1), 0)], t2_4);
                                continue SetTreeModule_compareStacks;
                            }
                            else {
                                comparer_mut = comparer;
                                l1_mut = l1;
                                l2_mut = ofArrayWithTail([SetTreeModule_empty(), SetTreeLeaf$1_$ctor_2B595(SetTreeLeaf$1__get_Key(x2_2))], t2_4);
                                continue SetTreeModule_compareStacks;
                            }
                        default:
                            throw new Exception("unexpected state in SetTree.compareStacks");
                    }
                }
                else {
                    comparer_mut = comparer;
                    l1_mut = tail(l1);
                    l2_mut = tail(l2);
                    continue SetTreeModule_compareStacks;
                }
            }
            else {
                return 1;
            }
        }
        else if (isEmpty(l2)) {
            return 0;
        }
        else {
            return -1;
        }
    }
}
function SetTreeModule_compare(comparer, t1, t2) {
    if (t1 == null) {
        if (t2 == null) {
            return 0;
        }
        else {
            return -1;
        }
    }
    else if (t2 == null) {
        return 1;
    }
    else {
        return SetTreeModule_compareStacks(comparer, singleton$1(t1), singleton$1(t2)) | 0;
    }
}
function SetTreeModule_copyToArray(s, arr, i) {
    let j = i;
    SetTreeModule_iter((x) => {
        setItem(arr, j, x);
        j = ((j + 1) | 0);
    }, s);
}
function SetTreeModule_mkFromEnumerator(comparer_mut, acc_mut, e_mut) {
    SetTreeModule_mkFromEnumerator: while (true) {
        const comparer = comparer_mut, acc = acc_mut, e = e_mut;
        if (e["System.Collections.IEnumerator.MoveNext"]()) {
            comparer_mut = comparer;
            acc_mut = SetTreeModule_add(comparer, e["System.Collections.Generic.IEnumerator`1.get_Current"](), acc);
            e_mut = e;
            continue SetTreeModule_mkFromEnumerator;
        }
        else {
            return acc;
        }
    }
}
function SetTreeModule_ofArray(comparer, l) {
    return fold$3((acc, k) => SetTreeModule_add(comparer, k, acc), SetTreeModule_empty(), l);
}
function SetTreeModule_ofList(comparer, l) {
    return fold$1((acc, k) => SetTreeModule_add(comparer, k, acc), SetTreeModule_empty(), l);
}
function SetTreeModule_ofSeq(comparer, c) {
    if (isArrayLike(c)) {
        return SetTreeModule_ofArray(comparer, c);
    }
    else if (c instanceof FSharpList) {
        return SetTreeModule_ofList(comparer, c);
    }
    else {
        const ie = getEnumerator(c);
        try {
            return SetTreeModule_mkFromEnumerator(comparer, SetTreeModule_empty(), ie);
        }
        finally {
            disposeSafe(ie);
        }
    }
}
class FSharpSet {
    tree;
    comparer;
    constructor(comparer, tree) {
        this.comparer = comparer;
        this.tree = tree;
    }
    GetHashCode() {
        const this$ = this;
        return FSharpSet__ComputeHashCode(this$) | 0;
    }
    Equals(other) {
        let that = undefined;
        const this$ = this;
        return (other instanceof FSharpSet) && ((that = other, SetTreeModule_compare(FSharpSet__get_Comparer(this$), FSharpSet__get_Tree(this$), FSharpSet__get_Tree(that)) === 0));
    }
    toString() {
        const this$ = this;
        let result = "set [";
        let first = true;
        const enumerator = getEnumerator(this$);
        try {
            while (enumerator["System.Collections.IEnumerator.MoveNext"]()) {
                let x = undefined, matchValue = undefined, s = undefined;
                const x_1 = enumerator["System.Collections.Generic.IEnumerator`1.get_Current"]();
                result = ((first ? result : (result + "; ")) + ((x = x_1, (matchValue = x, (typeof matchValue === "string") ? ((s = matchValue, ("\"" + s) + "\"")) : toString$2(x)))));
                first = false;
            }
        }
        finally {
            disposeSafe(enumerator);
        }
        return result + "]";
    }
    get [Symbol.toStringTag]() {
        return "FSharpSet";
    }
    toJSON() {
        const this$ = this;
        return Array.from(this$);
    }
    CompareTo(other) {
        let that = undefined;
        const this$ = this;
        return ((other instanceof FSharpSet) ? ((that = other, SetTreeModule_compare(FSharpSet__get_Comparer(this$), FSharpSet__get_Tree(this$), FSharpSet__get_Tree(that)))) : 1) | 0;
    }
    "System.Collections.Generic.ICollection`1.Add2B595"(x) {
        throw NotSupportedException_$ctor_Z721C83C5("ReadOnlyCollection");
    }
    "System.Collections.Generic.ICollection`1.Clear"() {
        throw NotSupportedException_$ctor_Z721C83C5("ReadOnlyCollection");
    }
    "System.Collections.Generic.ICollection`1.Remove2B595"(x) {
        throw NotSupportedException_$ctor_Z721C83C5("ReadOnlyCollection");
    }
    "System.Collections.Generic.ICollection`1.Contains2B595"(x) {
        const s = this;
        return SetTreeModule_mem(FSharpSet__get_Comparer(s), x, FSharpSet__get_Tree(s));
    }
    "System.Collections.Generic.ICollection`1.CopyToZ3B4C077E"(arr, i) {
        const s = this;
        SetTreeModule_copyToArray(FSharpSet__get_Tree(s), arr, i);
    }
    "System.Collections.Generic.ICollection`1.get_IsReadOnly"() {
        return true;
    }
    "System.Collections.Generic.ICollection`1.get_Count"() {
        const s = this;
        return FSharpSet__get_Count(s) | 0;
    }
    "System.Collections.Generic.IReadOnlyCollection`1.get_Count"() {
        const s = this;
        return FSharpSet__get_Count(s) | 0;
    }
    GetEnumerator() {
        const s = this;
        return SetTreeModule_mkIEnumerator(FSharpSet__get_Tree(s));
    }
    [Symbol.iterator]() {
        return toIterator(getEnumerator(this));
    }
    "System.Collections.IEnumerable.GetEnumerator"() {
        const s = this;
        return SetTreeModule_mkIEnumerator(FSharpSet__get_Tree(s));
    }
    get size() {
        const s = this;
        return FSharpSet__get_Count(s) | 0;
    }
    add(k) {
        throw new Exception("Set cannot be mutated");
    }
    clear() {
        throw new Exception("Set cannot be mutated");
    }
    delete(k) {
        throw new Exception("Set cannot be mutated");
    }
    has(k) {
        const s = this;
        return FSharpSet__Contains(s, k);
    }
    keys() {
        const s = this;
        return map$1((x) => x, s);
    }
    values() {
        const s = this;
        return map$1((x) => x, s);
    }
    entries() {
        const s = this;
        return map$1((v) => [v, v], s);
    }
    forEach(f, thisArg) {
        const s = this;
        iterate((x) => {
            f(x, x, s);
        }, s);
    }
}
function FSharpSet_$ctor(comparer, tree) {
    return new FSharpSet(comparer, tree);
}
function FSharpSet__get_Comparer(set$) {
    return set$.comparer;
}
function FSharpSet__get_Tree(set$) {
    return set$.tree;
}
function FSharpSet__get_Count(s) {
    return SetTreeModule_count(FSharpSet__get_Tree(s)) | 0;
}
function FSharpSet__Contains(s, value) {
    return SetTreeModule_mem(FSharpSet__get_Comparer(s), value, FSharpSet__get_Tree(s));
}
function FSharpSet__ComputeHashCode(this$) {
    let res = 0;
    const enumerator = getEnumerator(this$);
    try {
        while (enumerator["System.Collections.IEnumerator.MoveNext"]()) {
            const x_1 = enumerator["System.Collections.Generic.IEnumerator`1.get_Current"]();
            res = ((((res << 1) + structuralHash(x_1)) + 631) | 0);
        }
    }
    finally {
        disposeSafe(enumerator);
    }
    return Math.abs(res) | 0;
}
function ofSeq(elements, comparer) {
    return FSharpSet_$ctor(comparer, SetTreeModule_ofSeq(comparer, elements));
}

const UriKind = {
    RelativeOrAbsolute: 0,
    Absolute: 1,
    Relative: 2,
};
const ok = (value) => ({
    tag: "ok",
    value,
});
const error = (error) => ({ tag: "error", error });
class Uri {
    uri;
    constructor(state) {
        this.uri = state;
    }
    static isAbsoluteUri(uri) {
        try {
            new URL(uri);
            return true;
        }
        catch {
            return false;
        }
    }
    static tryCreateWithKind(uri, kind) {
        switch (kind) {
            case UriKind.Absolute:
                return Uri.isAbsoluteUri(uri)
                    ? ok(new Uri({ original: uri, value: new URL(uri), kind }))
                    : error("Invalid URI: The format of the URI could not be determined.");
            case UriKind.Relative:
                return Uri.isAbsoluteUri(uri)
                    ? error("URI is not a relative path.")
                    : ok(new Uri({ original: uri, value: uri, kind }));
            case UriKind.RelativeOrAbsolute:
                return Uri.isAbsoluteUri(uri)
                    ? ok(new Uri({ original: uri, value: new URL(uri), kind: UriKind.Absolute }))
                    : ok(new Uri({ original: uri, value: uri, kind: UriKind.Relative }));
            default:
                const never = kind;
                return never;
        }
    }
    static tryCreateWithBase(baseUri, relativeUri) {
        return baseUri.uri.kind !== UriKind.Absolute
            ? error("Base URI should have Absolute kind")
            : typeof relativeUri === "string"
                ? ok(new Uri({
                    original: new URL(relativeUri, baseUri.uri.value).toString(),
                    value: new URL(relativeUri, baseUri.uri.value),
                    kind: UriKind.Absolute,
                }))
                : relativeUri.uri.kind === UriKind.Relative
                    ? ok(new Uri({
                        original: new URL(relativeUri.uri.value, baseUri.uri.value).toString(),
                        value: new URL(relativeUri.uri.value, baseUri.uri.value),
                        kind: UriKind.Absolute,
                    }))
                    : ok(baseUri);
    }
    static tryCreateImpl(value, kindOrUri = UriKind.Absolute) {
        return typeof value === "string"
            ? typeof kindOrUri !== "number"
                ? error("Kind must be specified when the baseUri is a string.")
                : Uri.tryCreateWithKind(value, kindOrUri)
            : typeof kindOrUri === "number"
                ? error("Kind should not be specified when the baseUri is an absolute Uri.")
                : Uri.tryCreateWithBase(value, kindOrUri);
    }
    static create(value, kindOrUri = UriKind.Absolute) {
        const result = Uri.tryCreateImpl(value, kindOrUri);
        switch (result.tag) {
            case "ok":
                return result.value;
            case "error":
                throw new Exception(result.error);
            default:
                const never = result;
                return never;
        }
    }
    static tryCreate(value, kindOrUri = UriKind.Absolute, out) {
        const result = Uri.tryCreateImpl(value, kindOrUri);
        switch (result.tag) {
            case "ok":
                out.contents = result.value;
                return true;
            case "error":
                return false;
            default:
                const never = result;
                return never;
        }
    }
    toString() {
        switch (this.uri.kind) {
            case UriKind.Absolute:
                return decodeURIComponent(this.asUrl().toString());
            case UriKind.Relative:
                return this.uri.value;
            default:
                const never = this.uri;
                return never;
        }
    }
    asUrl() {
        switch (this.uri.kind) {
            case UriKind.Absolute:
                return this.uri.value;
            case UriKind.Relative:
                throw new Exception("This operation is not supported for a relative URI.");
            default:
                const never = this.uri;
                return never;
        }
    }
    get isAbsoluteUri() {
        return this.uri.kind === UriKind.Absolute;
    }
    get absoluteUri() {
        return this.asUrl().href;
    }
    get scheme() {
        const protocol = this.asUrl().protocol;
        return protocol.slice(0, protocol.length - 1);
    }
    get host() {
        const host = this.asUrl().host;
        if (host.includes(":")) {
            return host.split(":")[0];
        }
        else {
            return host;
        }
    }
    get absolutePath() {
        return this.asUrl().pathname;
    }
    get query() {
        return this.asUrl().search;
    }
    get isDefaultPort() {
        return this.port === 80;
    }
    get port() {
        const port = this.asUrl().port;
        if (port === "") {
            return 80;
        }
        else {
            return parseInt(port);
        }
    }
    get pathAndQuery() {
        const url = this.asUrl();
        return url.pathname + url.search;
    }
    get fragment() {
        return this.asUrl().hash;
    }
    get originalString() {
        return this.uri.original;
    }
}

function distinct(xs, comparer) {
    return delay(() => {
        const hashSet = new HashSet([], comparer);
        return filter((x) => addToSet(x, hashSet), xs);
    });
}
function List_distinct(xs, comparer) {
    return toList$1(distinct(xs, comparer));
}

function Eligibility_Ineligible(reasons) {
    return new Eligibility(1, [reasons]);
}
class Eligibility extends Union {
    constructor(tag, fields) {
        super();
        this.tag = tag;
        this.fields = fields;
    }
    tag;
    fields;
    cases() {
        return ["Eligible", "Ineligible"];
    }
    static Eligible = new Eligibility(0, []);
}
const EligibilityModule_publicNuGetHosts = ofSeq(["api.nuget.org", "www.nuget.org", "nuget.org"], {
    Compare: (x, y) => (comparePrimitives(x, y) | 0),
});
function EligibilityModule_isCommentOrEmpty(line) {
    const value = line.trim();
    if (isNullOrWhiteSpace(value)) {
        return true;
    }
    else {
        return value.startsWith("#");
    }
}
function EligibilityModule_sourceReason(line) {
    let uri = undefined;
    const value = trim(substring(line.trim(), "source ".length).trim(), "\"");
    let hasUserInfo;
    const schemeSeparator = indexOf(value, "://") | 0;
    if (schemeSeparator < 0) {
        hasUserInfo = false;
    }
    else {
        const authorityStart = (schemeSeparator + 3) | 0;
        const pathStart = value.indexOf("/", authorityStart) | 0;
        const authority = (pathStart < 0) ? substring(value, authorityStart) : substring(value, authorityStart, pathStart - authorityStart);
        hasUserInfo = (authority.indexOf("@") >= 0);
    }
    let matchValue;
    let outArg = defaultOf();
    matchValue = [Uri.tryCreate(value, 1, new FSharpRef(() => outArg, (v) => {
            outArg = v;
        })), outArg];
    let matchResult = undefined;
    if (matchValue[0]) {
        if ((uri = matchValue[1], ((uri.scheme === "https") && FSharpSet__Contains(EligibilityModule_publicNuGetHosts, uri.host.toLowerCase())) && !hasUserInfo)) {
            matchResult = 0;
        }
        else {
            matchResult = 1;
        }
    }
    else {
        matchResult = 1;
    }
    switch (matchResult) {
        case 0:
            return undefined;
        default:
            return concat$1("unsupported package source: ", value);
    }
}
function EligibilityModule_unsupportedReason(line) {
    const value = line.trim();
    const lower = value.toLowerCase();
    if (lower.startsWith("source ")) {
        return EligibilityModule_sourceReason(value);
    }
    else if (exists((value_1) => lower.startsWith(value_1), ofArray$1(["git ", "github ", "http ", "file ", "cache ", "credentials ", "username ", "password "]))) {
        return concat$1("unsupported Paket directive: ", value);
    }
    else {
        return undefined;
    }
}
/**
 * Validate the deliberately narrow credential-free runner policy for Paket inputs.
 *
 * decision: v1 accepts only HTTPS NuGet.org sources so the runner never needs package-source credentials
 * invariant: every non-comment source directive resolves to a public NuGet.org host without user information
 */
function EligibilityModule_inspect(dependencies) {
    let lines;
    const array = split(dependencies, ["\r", "\n"], undefined, 1);
    lines = array.filter((arg) => !EligibilityModule_isCommentOrEmpty(arg));
    const reasons = List_distinct(toList$1(delay(() => append$1(!lines.some((line_1) => startsWith(line_1.trim(), "source ")) ? singleton$2("paket.dependencies must declare a public NuGet.org source") : empty$2(), delay(() => choose$2(EligibilityModule_unsupportedReason, lines))))), {
        Equals: (x, y) => (x === y),
        GetHashCode: (x) => (stringHash(x) | 0),
    });
    if (isEmpty(reasons)) {
        return Eligibility.Eligible;
    }
    else {
        return Eligibility_Ineligible(reasons);
    }
}

const packageLine = /^\s{4}([A-Za-z0-9_.-]+) \(([^ )]+)/gu;
function packages(lockFile) {
    return ofArray(choose$2((line) => {
        const matched = match(packageLine, line);
        if (matched != null) {
            return [matched[1] || "", matched[2] || ""];
        }
        else {
            return undefined;
        }
    }, split(lockFile, ["\r", "\n"], undefined, 1)), {
        Compare: (x, y) => (comparePrimitives(x, y) | 0),
    });
}
function changes(previous, current) {
    const before = packages(previous);
    return choose((tupledArg) => {
        const name = tupledArg[0];
        const currentVersion = tupledArg[1];
        const matchValue = tryFind(name, before);
        let matchResult = undefined, previousVersion_1 = undefined;
        if (matchValue != null) {
            if (value(matchValue) !== currentVersion) {
                matchResult = 0;
                previousVersion_1 = value(matchValue);
            }
            else {
                matchResult = 1;
            }
        }
        else {
            matchResult = 1;
        }
        switch (matchResult) {
            case 0:
                return new VersionChange(name, previousVersion_1, currentVersion);
            default:
                return undefined;
        }
    }, toList(packages(current)));
}

function failed(message) {
    return new RunnerResult(RunnerStatus.Failed, undefined, empty$1(), singleton$1(message));
}
function run(archivePath, outputPath) {
    return singleton.Delay(() => singleton.Bind(awaitPromise(mkdtemp(join$1(tmpdir(), "paketabot-worker-"))), (_arg) => {
        const workspace = _arg;
        const write = (result) => awaitPromise(writeFile(outputPath, encodeResult(result)));
        return singleton.Bind(singleton.Delay(() => singleton.TryWith(singleton.Delay(() => {
            const options = {
                cwd: workspace,
                timeout: 60000,
                maxBuffer: 1048576,
            };
            return singleton.Bind(awaitPromise(execFile("tar", ["-xzf", archivePath, "--strip-components=1"], options)), (_arg_1) => {
                const dependenciesPath = join$1(workspace, "paket.dependencies");
                const lockPath = join$1(workspace, "paket.lock");
                return singleton.Bind(awaitPromise(readFile(dependenciesPath, "utf8")), (_arg_2) => {
                    const matchValue = EligibilityModule_inspect(_arg_2);
                    if (matchValue.tag === /* Eligible */ 0) {
                        return singleton.Bind(awaitPromise(readFile(lockPath, "utf8")), (_arg_4) => {
                            const previous = _arg_4;
                            const updateOptions = {
                                cwd: workspace,
                                timeout: 540000,
                                maxBuffer: 1048576,
                            };
                            return singleton.Bind(awaitPromise(execFile("paket", ["update", "--no-install"], updateOptions)), (_arg_5) => {
                                const stderr = _arg_5[1];
                                return singleton.Bind(awaitPromise(readFile(lockPath, "utf8")), (_arg_6) => {
                                    const current = _arg_6;
                                    return (current === previous) ? singleton.Bind(write(new RunnerResult(RunnerStatus.NoChange, undefined, empty$1(), empty$1())), () => singleton.Return(undefined)) : singleton.Bind(write(new RunnerResult(RunnerStatus.Updated, current, changes(previous, current), isNullOrWhiteSpace(stderr) ? empty$1() : singleton$1(stderr.trim()))), () => singleton.Return(undefined));
                                });
                            });
                        });
                    }
                    else {
                        const reasons = matchValue.fields[0];
                        return singleton.Bind(write(new RunnerResult(RunnerStatus.Rejected, undefined, empty$1(), reasons)), () => singleton.Return(undefined));
                    }
                });
            });
        }), (_arg_9) => singleton.Bind(write(failed(_arg_9.message)), () => singleton.Return(undefined)))), () => singleton.Bind(awaitPromise(rm(workspace, {
            recursive: true,
            force: true,
        })), () => singleton.Return(undefined)));
    }));
}
(function (_arg) {
    const matchValue = process.argv.slice(2);
    if (!equalsWith((x, y) => (x === y), matchValue, defaultOf()) && (matchValue.length === 2)) {
        const outputPath = item(1, matchValue);
        startAsPromise(run(item(0, matchValue), outputPath));
        return 0;
    }
    else {
        throw new Exception("usage: paketabot-runner <repository.tar.gz> <result.json>");
    }
})(typeof process === 'object' ? process.argv.slice(2) : []);
