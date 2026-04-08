import re

with open('src/components/RbsImportModal.tsx', 'r') as f:
    code = f.read()

# 1. Main modal container
code = code.replace(
    '<div className="bg-[#0f1115] border border-amber-500/30 rounded-xl shadow-[0_0_60px_rgba(245,158,11,0.2)] w-full max-w-4xl max-h-[90vh] flex flex-col">',
    '<div role="dialog" aria-modal="true" aria-labelledby="rbs-import-title" className="bg-[#0f1115] border border-amber-500/30 rounded-xl shadow-[0_0_60px_rgba(245,158,11,0.2)] w-full max-w-4xl max-h-[90vh] flex flex-col">'
)

# 2. H2 title
code = code.replace(
    '<h2 className="text-lg font-bold text-white">Import ReBirth RB-338 File</h2>',
    '<h2 id="rbs-import-title" className="text-lg font-bold text-white">Import ReBirth RB-338 File</h2>'
)

# 3. Import options button
btn_target = """                <button
                  onClick={() => setShowOptions(!showOptions)}
                  className="w-full p-3 bg-gray-900/50 flex items-center justify-between hover:bg-gray-800/50 transition-all"
                >"""
btn_replace = """                <button
                  onClick={() => setShowOptions(!showOptions)}
                  aria-expanded={showOptions}
                  aria-controls="import-options-panel"
                  className="w-full p-3 bg-gray-900/50 flex items-center justify-between hover:bg-gray-800/50 transition-all"
                >"""
code = code.replace(btn_target, btn_replace)

# 4. Options panel div
div_target = """                {showOptions && (
                  <div className="p-4 space-y-4 bg-gray-900/30">"""
div_replace = """                {showOptions && (
                  <div id="import-options-panel" className="p-4 space-y-4 bg-gray-900/30">"""
code = code.replace(div_target, div_replace)

# 5. Parsing progress section
progress_target = """          {/* Parse Progress */}
          {isParsing && (
            <div className="p-4 bg-amber-950/20 border border-amber-900/30 rounded-lg">"""
progress_replace = """          {/* Parse Progress */}
          {isParsing && (
            <div aria-live="polite" className="p-4 bg-amber-950/20 border border-amber-900/30 rounded-lg">"""
code = code.replace(progress_target, progress_replace)

# 6. Import song button
import_btn_target = """            <button
              onClick={handleImport}
              disabled={!isComplete || isImporting}
              className={`px-4 py-2 text-xs font-medium rounded transition-all flex items-center gap-2 ${"""
import_btn_replace = """            <button
              onClick={handleImport}
              disabled={!isComplete || isImporting}
              aria-busy={isImporting}
              className={`px-4 py-2 text-xs font-medium rounded transition-all flex items-center gap-2 ${"""
code = code.replace(import_btn_target, import_btn_replace)


with open('src/components/RbsImportModal.tsx', 'w') as f:
    f.write(code)
