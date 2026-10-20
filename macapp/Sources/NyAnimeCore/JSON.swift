import Foundation

/// A decoded JSON value with tolerant accessors.
///
/// The upstream API is inconsistent about types: the same field is a string on
/// one route and a number on another (`data_id`, `totalPages`, episode counts).
/// `Codable` would need a bespoke wrapper for each of those, so the payload is
/// decoded into this shape and normalised at the boundary instead.
public enum JSONValue: Sendable {
    case string(String)
    case number(Double)
    case bool(Bool)
    case object([String: JSONValue])
    case array([JSONValue])
    case null

    public init(any value: Any) {
        switch value {
        case let string as String:
            self = .string(string)
        case let number as NSNumber:
            // `NSNumber` covers Bool too, which would otherwise become 1/0.
            // JSONSerialization yields a boolean-backed NSNumber for JSON
            // booleans; its objCType is "c" (Intel, Linux) or "B" (Apple
            // silicon). Numeric scalars are always Int64 ("q") or Double ("d"),
            // so this cannot collide with a genuine number.
            let encoding = String(cString: number.objCType)
            if encoding == "c" || encoding == "B" {
                self = .bool(number.boolValue)
            } else {
                self = .number(number.doubleValue)
            }
        case let object as [String: Any]:
            self = .object(object.mapValues(JSONValue.init(any:)))
        case let array as [Any]:
            self = .array(array.map(JSONValue.init(any:)))
        default:
            self = .null
        }
    }

    public static func parse(_ data: Data) throws -> JSONValue {
        let raw = try JSONSerialization.jsonObject(with: data, options: [.fragmentsAllowed])
        return JSONValue(any: raw)
    }

    public subscript(key: String) -> JSONValue {
        guard case let .object(object) = self else { return .null }
        return object[key] ?? .null
    }

    public subscript(index: Int) -> JSONValue {
        guard case let .array(array) = self, array.indices.contains(index) else { return .null }
        return array[index]
    }

    /// The value as a string, coercing numbers. Empty string when absent.
    public var stringValue: String {
        switch self {
        case let .string(value):
            return value
        case let .number(value):
            return value.rounded() == value ? String(Int(value)) : String(value)
        case let .bool(value):
            return value ? "true" : "false"
        default:
            return ""
        }
    }

    /// The value as a string, or `nil` when empty — for optional fields.
    public var stringOrNil: String? {
        let value = stringValue
        return value.isEmpty ? nil : value
    }

    /// The value as an integer, tolerating `"12"`, `12`, `12.0` and `"1 / 24"`.
    public var intValue: Int {
        switch self {
        case let .number(value):
            return Int(value)
        case let .string(text):
            if let direct = Int(text) { return direct }
            // Some fields read like "Episodes: 24" or "12/24"; take the last number.
            let digits = text.split(whereSeparator: { !$0.isNumber }).last
            return digits.flatMap { Int($0) } ?? 0
        default:
            return 0
        }
    }

    public var intOrNil: Int? {
        let value = intValue
        return value == 0 ? nil : value
    }

    public var boolValue: Bool {
        switch self {
        case let .bool(value): return value
        case let .number(value): return value != 0
        case let .string(text): return text == "true" || text == "1"
        default: return false
        }
    }

    public var arrayValue: [JSONValue] {
        if case let .array(array) = self { return array }
        return []
    }

    public var objectValue: [String: JSONValue] {
        if case let .object(object) = self { return object }
        return [:]
    }

    /// Flatten a dictionary-of-arrays (`related_data`) into one list.
    public var flattened: [JSONValue] {
        switch self {
        case let .array(array):
            return array
        case let .object(object):
            return object.values.flatMap { $0.arrayValue }
        default:
            return []
        }
    }
}
