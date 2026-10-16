// Local integration-test receiver. Drag a row onto this window, then inspect
// the JSON at the output path passed as the first command-line argument.
import AppKit

final class DropView: NSView {
    let label = NSTextField(labelWithString: "Drop a file from Fast Files here")
    override init(frame: NSRect) {
        super.init(frame: frame)
        registerForDraggedTypes([.fileURL])
        label.frame = NSRect(x: 25, y: 100, width: 350, height: 60)
        label.font = NSFont.systemFont(ofSize: 18)
        label.lineBreakMode = .byWordWrapping
        label.maximumNumberOfLines = 3
        addSubview(label)
    }
    required init?(coder: NSCoder) { fatalError("Not used") }
    override func draggingEntered(_ sender: NSDraggingInfo) -> NSDragOperation { .copy }
    override func performDragOperation(_ sender: NSDraggingInfo) -> Bool {
        guard let urls = sender.draggingPasteboard.readObjects(forClasses: [NSURL.self], options: [.urlReadingFileURLsOnly: true]) as? [URL], !urls.isEmpty else { return false }
        label.stringValue = "Received file: " + urls.map { $0.lastPathComponent }.joined(separator: ", ")
        if CommandLine.arguments.count > 1 {
            let data = try! JSONSerialization.data(withJSONObject: urls.map { $0.path })
            try! data.write(to: URL(fileURLWithPath: CommandLine.arguments[1]))
        }
        return true
    }
}
let app = NSApplication.shared
app.setActivationPolicy(.regular)
let window = NSWindow(contentRect: NSRect(x: 1050, y: 300, width: 400, height: 240), styleMask: [.titled, .closable], backing: .buffered, defer: false)
window.title = "File Drop Test"
window.contentView = DropView(frame: NSRect(x: 0, y: 0, width: 400, height: 240))
window.makeKeyAndOrderFront(nil)
app.activate(ignoringOtherApps: true)
app.run()
