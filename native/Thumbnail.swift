import Foundation
import ImageIO
import UniformTypeIdentifiers
import Darwin

// Each decode is isolated from the UI, with a CPU limit and a wall timeout in Bun.
var cpuLimit = rlimit(rlim_cur: 12, rlim_max: 12)
_ = setrlimit(RLIMIT_CPU, &cpuLimit)
func fail(_ message: String) -> Never {
    FileHandle.standardError.write(Data(message.utf8)); exit(1)
}
guard CommandLine.arguments.count == 3 else { fail("Expected path and thumbnail size") }
let url = URL(fileURLWithPath: CommandLine.arguments[1])
let side = min(1600, max(64, Int(CommandLine.arguments[2]) ?? 240))
let options = [kCGImageSourceShouldCache: false] as CFDictionary
guard let source = CGImageSourceCreateWithURL(url as CFURL, options),
      let props = CGImageSourceCopyPropertiesAtIndex(source, 0, options) as? [CFString: Any],
      let width = props[kCGImagePropertyPixelWidth] as? Int,
      let height = props[kCGImagePropertyPixelHeight] as? Int,
      width > 0, height > 0, Double(width) * Double(height) <= 40_000_000 else {
    fail("Unsupported image or image exceeds 40 megapixels")
}
let thumbOptions: [CFString: Any] = [
    kCGImageSourceCreateThumbnailFromImageAlways: true,
    kCGImageSourceCreateThumbnailWithTransform: true,
    kCGImageSourceThumbnailMaxPixelSize: side,
    kCGImageSourceShouldCacheImmediately: true,
]
guard let image = CGImageSourceCreateThumbnailAtIndex(source, 0, thumbOptions as CFDictionary),
      let output = CFDataCreateMutable(nil, 0),
      let destination = CGImageDestinationCreateWithData(output, UTType.png.identifier as CFString, 1, nil) else {
    fail("Could not decode image")
}
CGImageDestinationAddImage(destination, image, nil)
guard CGImageDestinationFinalize(destination) else { fail("Could not encode thumbnail") }
FileHandle.standardOutput.write(output as Data)
