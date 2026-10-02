// 위젯 전용 스타일. 모든 선택자가 .qr 아래라 호스트 페이지 스타일과 섞이지 않는다.
export const CSS = `
.qr{--bg:#f6f7f9;--card:#fff;--ink:#1c2330;--mute:#667085;--line:#dfe3ea;--brand:#1f5fbf;--err:#c0262d;--warn:#b26a00;--info:#4b6b8a;--errbg:#fdecee;--warnbg:#fff4e0;--infobg:#eaf1f8;--okbg:#e6f4ea;--ok:#1e7a3a;
 color:var(--ink);font:15px/1.5 -apple-system,"Segoe UI","Noto Sans KR","Malgun Gothic",sans-serif;box-sizing:border-box}
@media (prefers-color-scheme:dark){.qr.qr-auto-dark{--bg:#14181f;--card:#1c222c;--ink:#e7ebf2;--mute:#97a1b2;--line:#2e3644;--brand:#6aa3ff;--err:#ff8b90;--warn:#ffc266;--info:#8fb3d6;--errbg:#3a1f23;--warnbg:#3a2f18;--infobg:#1f2b38;--okbg:#1c3324;--ok:#7fd69a}}
.qr *{box-sizing:border-box}
.qr [hidden]{display:none!important}
.qr .qr-tabs{display:flex;gap:6px;flex-wrap:wrap;margin-bottom:12px}
.qr .qr-tabs button{border:1px solid var(--line);background:var(--card);color:var(--ink);padding:8px 14px;border-radius:8px;cursor:pointer;font:inherit}
.qr .qr-tabs button.on{background:var(--brand);border-color:var(--brand);color:#fff}
.qr .qr-tabs .qr-right{margin-left:auto}
.qr small{color:var(--mute);font-weight:400}
.qr .qr-card{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:16px;margin-bottom:14px}
.qr h2{font-size:16px;margin:0 0 12px}.qr h3{font-size:14px;margin:0}
.qr .qr-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:12px}
.qr .qr-drop{display:flex;flex-direction:column;gap:4px;border:2px dashed var(--line);border-radius:10px;padding:14px;cursor:pointer;min-height:112px}
.qr .qr-drop:hover,.qr .qr-drop.over{border-color:var(--brand)}
.qr .qr-drop span{color:var(--mute);font-size:13px}.qr .qr-drop em{color:var(--brand);font-style:normal;font-size:13px;word-break:break-all}
.qr .qr-drop input{display:none}
.qr .qr-row{display:flex;gap:12px;align-items:center;flex-wrap:wrap;margin-top:12px}.qr .qr-row.between{justify-content:space-between;margin-top:0}
.qr button{font:inherit;padding:8px 14px;border-radius:8px;border:1px solid var(--line);background:var(--card);color:var(--ink);cursor:pointer}
.qr button.primary{background:var(--brand);border-color:var(--brand);color:#fff}.qr button:disabled{opacity:.45;cursor:not-allowed}
.qr select,.qr input[type=number],.qr input[type=text]{font:inherit;padding:6px 8px;border-radius:8px;border:1px solid var(--line);background:var(--card);color:var(--ink)}
.qr .qr-mute{color:var(--mute);font-size:13px}.qr .qr-chk{font-size:13px;color:var(--mute)}
.qr .qr-counts{display:flex;gap:10px;flex-wrap:wrap}.qr .qr-pill{padding:6px 12px;border-radius:999px;font-weight:600;font-size:14px}
.qr .qr-pill.error{background:var(--errbg);color:var(--err)}.qr .qr-pill.warn{background:var(--warnbg);color:var(--warn)}.qr .qr-pill.info{background:var(--infobg);color:var(--info)}.qr .qr-pill.ok{background:var(--okbg);color:var(--ok)}
.qr details.qr-grp{background:var(--card);border:1px solid var(--line);border-radius:12px;margin-bottom:10px}
.qr details.qr-grp>summary{padding:12px 16px;cursor:pointer;display:flex;gap:10px;align-items:center;flex-wrap:wrap}
.qr .qr-body{padding:0 8px 8px;overflow-x:auto}
.qr table{width:100%;border-collapse:collapse;font-size:13.5px}.qr th{text-align:left;color:var(--mute);font-weight:600;padding:6px 8px;border-bottom:1px solid var(--line)}
.qr td{padding:7px 8px;border-bottom:1px solid var(--line);vertical-align:top}.qr td.sev{white-space:nowrap;width:1%}.qr td.cat{white-space:nowrap;color:var(--mute)}.qr td.where{color:var(--mute);font-size:12.5px}
.qr .qr-badge{display:inline-block;padding:1px 8px;border-radius:6px;font-size:12px;font-weight:700}
.qr .qr-badge.error{background:var(--errbg);color:var(--err)}.qr .qr-badge.warn{background:var(--warnbg);color:var(--warn)}.qr .qr-badge.info{background:var(--infobg);color:var(--info)}
.qr .qr-cfg-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:14px}
.qr .qr-cfg-box{border:1px solid var(--line);border-radius:10px;padding:12px}
.qr .qr-cfg-box label{display:flex;justify-content:space-between;align-items:center;gap:10px;margin:6px 0}
.qr .qr-cfg-box input[type=number]{width:140px;text-align:right}
.qr textarea{width:100%;min-height:120px;font:12.5px/1.5 ui-monospace,Menlo,Consolas,monospace;background:var(--bg);color:var(--ink);border:1px solid var(--line);border-radius:8px;padding:10px}
.qr .qr-msg{font-size:13px}.qr .qr-msg.err{color:var(--err)}.qr .qr-msg.ok{color:var(--ok)}
`;
