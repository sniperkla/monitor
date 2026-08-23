#!/bin/bash
rm -rf patch_test5
mkdir patch_test5
cd patch_test5
echo -e "line1\nline2\nline3" > file.txt
p=$(pwd)/file.txt
cat << INNEREOF > patch5.diff
--- $p
+++ $p
@@ -1,3 +1,3 @@
 line1
-line2
+line2_final
 line3
INNEREOF
tmpFile=$(pwd)/patch5.diff
ABS_PATH=$(pwd)/file.txt
DIR_NAME=$(dirname "$ABS_PATH")
BASE_NAME=$(basename "$ABS_PATH")
echo "DIR_NAME IS $DIR_NAME"
echo "tmpFile is $tmpFile"
cd "$DIR_NAME"

# Linux sed syntax
sed -i "s|^--- .*|--- $BASE_NAME|" "${tmpFile}" || echo "sed 1 failed"
sed -i "s|^+++ .*|+++ $BASE_NAME|" "${tmpFile}" || echo "sed 2 failed"

cat "$tmpFile"

echo "Running dry run..."
patch -p0 --dry-run < "${tmpFile}"
