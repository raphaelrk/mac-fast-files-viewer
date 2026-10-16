import AppKit
import UniformTypeIdentifiers

// Loaded into the Electrobun process. AppKit's main-thread event monitor starts
// a real file-URL drag from the mouse event, rather than an HTML text/URL drag.
private final class FileDragSource: NSObject, NSDraggingSource {
    func draggingSession(_ session: NSDraggingSession, sourceOperationMaskFor context: NSDraggingContext) -> NSDragOperation {
        return [.copy, .link]
    }
}
private let dragSource = FileDragSource()
private var monitor: Any?
private var armedPaths: [String] = []
private var targetTitle = "Fast Files"
private var mouseDownPoint: NSPoint?

@_cdecl("ff_install_file_drag")
public func installFileDrag() {
    DispatchQueue.main.async {
        guard monitor == nil else { return }
        monitor = NSEvent.addLocalMonitorForEvents(matching: [.leftMouseDown, .leftMouseDragged, .leftMouseUp]) { event in
            if event.type == .leftMouseDown {
                armedPaths = []
                mouseDownPoint = event.locationInWindow
            } else if event.type == .leftMouseUp {
                armedPaths = []
                mouseDownPoint = nil
            } else if !armedPaths.isEmpty,
                      let window = event.window, window.title == targetTitle,
                      let view = window.contentView, let start = mouseDownPoint,
                      hypot(event.locationInWindow.x - start.x, event.locationInWindow.y - start.y) >= 5 {
                let paths = armedPaths
                armedPaths = []
                mouseDownPoint = nil
                let point = view.convert(event.locationInWindow, from: nil)
                let genericIcon = NSWorkspace.shared.icon(for: .data)
                let items = paths.enumerated().map { index, path -> NSDraggingItem in
                    let item = NSDraggingItem(pasteboardWriter: NSURL(fileURLWithPath: path))
                    let icon = index < 8 ? NSWorkspace.shared.icon(forFile: path) : genericIcon
                    item.setDraggingFrame(NSRect(x: point.x - 24, y: point.y - 24, width: 48, height: 48), contents: icon)
                    return item
                }
                let session = view.beginDraggingSession(with: items, event: event, source: dragSource)
                session.draggingFormation = .stack
                session.animatesToStartingPositionsOnCancelOrFail = true
                return nil
            }
            return event
        }
    }
}

@_cdecl("ff_arm_file_drag")
public func armFileDrag(_ pathPointer: UnsafePointer<CChar>) {
    let json = String(cString: pathPointer)
    guard let data = json.data(using: .utf8), let paths = (try? JSONSerialization.jsonObject(with: data)) as? [String], !paths.isEmpty else { return }
    DispatchQueue.main.async {
        // An HTTP request finishing after mouse-up must not arm the next gesture.
        guard NSEvent.pressedMouseButtons & 1 != 0, mouseDownPoint != nil else { return }
        armedPaths = paths
    }
}
