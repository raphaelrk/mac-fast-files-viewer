import Foundation

// One bounded batch per invocation; these are filesystem resource values used
// by Finder, rather than Spotlight indexing dates or a guessed ctime fallback.
let data = FileHandle.standardInput.readDataToEndOfFile()
let paths = (try? JSONSerialization.jsonObject(with: data)) as? [String] ?? []
let result: [[String: Any]] = paths.prefix(512).map { path in
    let values = try? URL(fileURLWithPath: path).resourceValues(forKeys: [.addedToDirectoryDateKey, .localizedTypeDescriptionKey])
    return ["added": values?.addedToDirectoryDate.map { $0.timeIntervalSince1970 * 1000 } as Any? ?? NSNull(),
            "kindLabel": values?.localizedTypeDescription as Any? ?? NSNull()]
}
FileHandle.standardOutput.write(try! JSONSerialization.data(withJSONObject: result))
