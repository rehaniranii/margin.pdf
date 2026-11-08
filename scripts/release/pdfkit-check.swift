// Independent, read-only PDF validation using macOS PDFKit/CoreGraphics.
// Usage: swift -module-cache-path output/phase6/swift-cache scripts/release/pdfkit-check.swift input.pdf [render.png] [required text] [forbidden text]
import Foundation
import PDFKit
import AppKit

enum CheckError: Error { case failed(String) }
do {
let args=CommandLine.arguments
if args.count < 2 { throw CheckError.failed("Supply a PDF path") }
guard let doc=PDFDocument(url:URL(fileURLWithPath:args[1])),doc.pageCount>0 else {throw CheckError.failed("PDFKit could not open the PDF")}
let texts=(0..<doc.pageCount).map { doc.page(at:$0)?.string ?? "" }
// Text assertions target page 1: repeated words on untouched pages must survive.
let text=texts[0]
if args.count>3 && !text.contains(args[3]) {throw CheckError.failed("Required text missing in independent reader")}
if args.count>4 && !args[4].isEmpty && text.contains(args[4]) {throw CheckError.failed("Removed text still extractable in independent reader")}
var pages:[[String:Any]]=[]
for i in 0..<min(doc.pageCount,3) {
 let page=doc.page(at:i)!,bounds=page.bounds(for:.cropBox)
 pages.append(["page":i+1,"crop":[bounds.minX,bounds.minY,bounds.width,bounds.height],"rotation":page.rotation,"text":texts[i]])
}
if args.count>2 && args[2] != "-" {
 guard let page=doc.page(at:0) else {throw CheckError.failed("Missing first page")}
 let bounds=page.bounds(for:.cropBox),turned=abs(page.rotation)%180==90
 let width=turned ? bounds.height:bounds.width,height=turned ? bounds.width:bounds.height
 let scale=min(1,1400/max(width,height))
 guard let image=page.thumbnail(of:NSSize(width:width*scale,height:height*scale),for:.cropBox).tiffRepresentation,
       let bitmap=NSBitmapImageRep(data:image),let png=bitmap.representation(using:.png,properties:[:]) else {throw CheckError.failed("Independent rendering failed")}
 try png.write(to:URL(fileURLWithPath:args[2]))
}
let report:[String:Any] = ["reader":"Apple PDFKit","pageCount":doc.pageCount,"isEncrypted":doc.isEncrypted,"pages":pages]
let json=try JSONSerialization.data(withJSONObject:report,options:[.prettyPrinted,.sortedKeys])
print(String(decoding:json,as:UTF8.self))
} catch {
 FileHandle.standardError.write(Data("PDFKit check failed: \(error)\n".utf8))
 exit(1)
}
