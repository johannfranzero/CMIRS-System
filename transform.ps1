$p = "D:\CMIRS-System\my-app\scripts\remote-role-matrix-verification.sql"
$lines = [IO.File]::ReadAllLines($p)
$out = New-Object System.Collections.Generic.List[string]
$inTry = $false
$tryInd = ""
foreach ($l in $lines) {
    if ($l -match '^\s*v_msg := v_try\(format\(') {
        if ($l -match '^(\s*)v_msg := v_try\(') { $tryInd = $matches[1] }
        $out.Add($tryInd + "v_msg := 'ALLOWED';")
        $out.Add($tryInd + "BEGIN")
        $rest = $l.Substring($l.IndexOf('format(') + 6)
        $out.Add($tryInd + "  EXECUTE format(" + $rest)
        $inTry = $true
        continue
    }
    if ($inTry -and $l -match '^\s*.*\);$') {
        $newl = [regex]::Replace($l, '\)\);$', ');')
        $out.Add($newl)
        $out.Add($tryInd + "  EXCEPTION WHEN OTHERS THEN")
        $out.Add($tryInd + "    v_msg := SQLERRM;")
        $out.Add($tryInd + "  END;")
        $inTry = $false
        continue
    }
    if ($l -match 'PERFORM v_act_as\(') {
        $out.Add([regex]::Replace($l, 'PERFORM v_act_as\(([^)]*)\)', "PERFORM set_config('request.jwt.claims', json_build_object('sub', $1, 'role', 'authenticated')::text, true);"))
        continue
    }
    $out.Add($l)
}
[IO.File]::WriteAllLines($p, $out)
$t = [IO.File]::ReadAllText($p)
$n1 = [regex]::Matches($t, 'v_act_as|v_try|pg_temp').Count
Write-Output ("remaining helper refs: " + $n1)
