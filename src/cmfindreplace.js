// thanks to 
// https://github.com/codemirror/codemirror/blob/master/addon/search/search.js

import './cmfindreplace.css'
(function (mod) {
  if (typeof exports == "object" && typeof module == "object") // CommonJS
    mod(require("codemirror"))
  else if (typeof define == "function" && define.amd) // AMD
    define(["codemirror"], mod)
  else // Plain browser env
    mod(CodeMirror)
})((CodeMirror) => {
  'use strict'

  let createPanel = (cm, temp, position) => {
    let el = document.createElement('div')
    el.className = 'cm-toolpanel-dialog'

    if (typeof temp == 'string') {
      el.innerHTML = temp
    } else {
      el.appendChild(temp)
    }
    let panel = cm.addPanel(el, {
      position: position ? position.bottom ? 'bottom' : 'top' : 'top'
    })
    return panel
  }

  let closePanel = (cm) => {
    let state = cm.state.advancedDialog
    if (!state || !state.current) {
      return
    }

    state.current.panel.clear()

    if (state.current.onClose) state.current.onClose(state.current.panel.node)
    delete state.current
    cm.focus()
  }

  CodeMirror.defineExtension('openToolpanelDialog', function (temp, options) {
    if (!this.addPanel) throw `Panel.js addon.`
    if (!options) options = {}
    if (!this.state.advancedDialog) this.state.advancedDialog = {}

    if (this.state.advancedDialog.current) closePanel(this)

    let panel = createPanel(this, temp, options.bottom)
    this.state.advancedDialog.current = {
      panel: panel,
      onClose: options.onClose
    }
    let inputs = panel.node.getElementsByTagName("input");
    let buttons = panel.node.getElementsByTagName("button");
    if (inputs && inputs.length > 0 && options.inputBehaviours) {
      for (let i = 0; i < options.inputBehaviours.length; i++) {
        let behaviour = options.inputBehaviours[i];
        let input = inputs[i];
        if (behaviour.value) {
          input.value = behaviour.value;
        }

        if (!!behaviour.focus) {
          input.focus();
        }

        if (!!behaviour.selectValueOnOpen) {
          input.select();
        }

        if (behaviour.onInput) {
          CodeMirror.on(input, "input", (e) => {
            behaviour.onInput(inputs, e);
          });
        }

        if (behaviour.onKeyUp) {
          CodeMirror.on(input, "keyup", (e) => {
            behaviour.onKeyUp(inputs, e);
          });
        }

        CodeMirror.on(input, "keydown", (e) => {
          if (behaviour.onKeyDown && behaviour.onKeyDown(inputs, e)) {
            return;
          }

          if (e.keyCode === 27 || (!!behaviour.closeOnEnter && e.keyCode === 13)) {
            input.blur();
            CodeMirror.e_stop(e);
            closePanel(this);
          } else if (e.keyCode === 13 && behaviour.callback) {
            behaviour.callback(inputs, e);
          }
        });

        if (behaviour.closeOnBlur !== false) CodeMirror.on(input, "blur", () => {
          closePanel(this);
        });
      }
    }

    if (buttons && buttons.length > 0 && options.buttonBehaviours) {
      for (let i = 0; i < options.buttonBehaviours.length; i++) {
        let behaviour = options.buttonBehaviours[i];
        if (!!behaviour.callback) {
          CodeMirror.on(buttons[i], "click", (e) => {
            behaviour.callback(inputs, e);
          });
        } else {
          CodeMirror.on(buttons[i], "click", () => {
            closePanel(this);
          });
        }
      }
    }
    return () => {
      closePanel(this)
    }
  })

  let numMatches = 0

  const findDialog = `
    <div class="row find">
      <label for="CodeMirror-find-field">Find:</label>
      <input id="CodeMirror-find-field" type="text" class="CodeMirror-search-field" placeholder="Find" />
      <span class="CodeMirror-search-hint">(Use /re/ syntax for regexp search)</span>
      <span class="CodeMirror-search-count"></span>
    </div>
    <div class="CodeMirror-findreplace-btn">
      <button>Find Previous</button>
      <button>Find Next</button>
      <button>Close</button>
      <span class="CodeMirror-search-hint">(Use Shift-Ctrl-F (Win), Cmd-Alt-F (Mac) for Replace)</span>
    </div>
  `

  const replaceDialog = `
    <div class="row find">
      <label for="CodeMirror-find-field">Replace:</label>
      <input id="CodeMirror-find-field" type="text" class="CodeMirror-search-field" placeholder="Find" />
      <span class="CodeMirror-search-hint">(Use /re/ syntax for regexp search)</span>
      <span class="CodeMirror-search-count"></span>
    </div>
    <div class="row replace">
      <label for="CodeMirror-replace-field">With:</label>
      <input id="CodeMirror-replace-field" type="text" class="CodeMirror-search-field" placeholder="Replace" />
    </div>
    <div class="CodeMirror-findreplace-btn">
      <button>Find Previous</button>
      <button>Find Next</button>
      <button>Replace</button>
      <button>Replace All</button>
      <button>Close</button>
    </div>
  `

  function searchOverlay(query, caseInsensitive) {
    if (typeof query == "string")
      query = new RegExp(query.replace(/[\-\[\]\/\{\}\(\)\*\+\?\.\\\^\$\|]/g, "\\$&"), caseInsensitive ? "gi" : "g");
    else if (!query.global)
      query = new RegExp(query.source, query.ignoreCase ? "gi" : "g");

    return {
      token: (stream) => {
        query.lastIndex = stream.pos;
        var match = query.exec(stream.string);
        if (match && match.index == stream.pos) {
          stream.pos += match[0].length || 1;
          return "searching";
        } else if (match) {
          stream.pos = match.index;
        } else {
          stream.skipToEnd();
        }
      }
    };
  }

  function SearchState() {
    this.posFrom = this.posTo = this.lastQuery = this.query = null;
    this.overlay = null;
  }

  function getSearchState(cm) {
    return cm.state.search || (cm.state.search = new SearchState());
  }

  function queryCaseInsensitive(query) {
    return typeof query == "string" && query == query.toLowerCase();
  }

  function getSearchCursor(cm, query, pos) {
    // Heuristic: if the query string is all lowercase, do a case insensitive search.
    return cm.getSearchCursor(query, pos, {
      caseFold: queryCaseInsensitive(query),
      multiline: true
    });
  }

  function parseString(string) {
    return string.replace(/\\(.)/g, function (_, ch) {
      if (ch == "n") return "\n"
      if (ch == "r") return "\r"
      return ch
    })
  }

  function parseQuery(query) {
    var isRE = query.match(/^\/(.*)\/([a-z]*)$/);
    if (isRE) {
      try {
        query = new RegExp(isRE[1], isRE[2].indexOf("i") == -1 ? "" : "i");
      } catch (e) {} // Not a regular expression after all, do a string search
    } else {
      query = parseString(query)
    }
    if (typeof query == "string" ? query == "" : query.test(""))
      query = /x^/;
    return query;
  }

  function startSearch(cm, state, query) {
    if (!query || query === '') return;
    state.queryText = query;
    state.query = parseQuery(query);
    cm.removeOverlay(state.overlay, queryCaseInsensitive(state.query));
    state.overlay = searchOverlay(state.query, queryCaseInsensitive(state.query));
    cm.addOverlay(state.overlay);
    if (cm.showMatchesOnScrollbar) {
      if (state.annotate) {
        state.annotate.clear();
        state.annotate = null;
      }
      state.annotate = cm.showMatchesOnScrollbar(state.query, queryCaseInsensitive(state.query));
    }
  }

  function doSearch (cm, query, reverse, moveToNext) {
    var hiding = null;
    var state = getSearchState(cm);
    if (query != state.queryText) {
      startSearch(cm, state, query);
      state.posFrom = state.posTo = cm.getCursor();
    }
    if (moveToNext || moveToNext === undefined) {
      findNext(cm, (reverse || false));
    }
    updateCount(cm);
  }

  function clearSearch(cm) {
    cm.operation(function () {
      var state = getSearchState(cm);
      state.lastQuery = state.query;
      if (!state.query) return;
      state.query = state.queryText = null;
      cm.removeOverlay(state.overlay);
      if (state.annotate) {
        state.annotate.clear();
        state.annotate = null;
      }
    });
  }

  function findNext(cm, rev, callback) {
    cm.operation(function () {
      var state = getSearchState(cm);
      var cursor = getSearchCursor(cm, state.query, rev ? state.posFrom : state.posTo);
      if (!cursor.find(rev)) {
        cursor = getSearchCursor(cm, state.query, rev ? CodeMirror.Pos(cm.lastLine()) : CodeMirror.Pos(cm.firstLine(), 0));
        if (!cursor.find(rev)) return;
      }
      cm.setSelection(cursor.from(), cursor.to());
      cm.scrollIntoView({
        from: cursor.from(),
        to: cursor.to()
      }, 20);
      state.posFrom = cursor.from();
      state.posTo = cursor.to();
      if (callback) callback(cursor.from(), cursor.to())
    });
  }

  function replaceNext(cm, query, text) {
    let cursor = getSearchCursor(cm, query, cm.getCursor('from'));
    let start = cursor.from();
    let match = cursor.findNext();
    if (!match) {
      cursor = getSearchCursor(cm, query);
      match = cursor.findNext();
      if (!match ||
        (start && cursor.from().line === start.line && cursor.from().ch === start.ch)) return;
    }
    cm.setSelection(cursor.from(), cursor.to());
    cm.scrollIntoView({
      from: cursor.from(),
      to: cursor.to()
    });
    cursor.replace(typeof query === 'string' ? text :
      text.replace(/\$(\d)/g, (_, i) => {
        return match[i];
      }));
  }

  function replaceAll(cm, query, text) {
    cm.operation(function () {
      for (var cursor = getSearchCursor(cm, query); cursor.findNext();) {
        if (typeof query != "string") {
          var match = cm.getRange(cursor.from(), cursor.to()).match(query);
          cursor.replace(text.replace(/\$(\d)/g, function (_, i) {
            return match[i];
          }));
        } else cursor.replace(text);
      }
    });
  }

  function closeSearchCallback(cm, state) {
    if (state.annotate) {
      state.annotate.clear();
      state.annotate = null;
    }
    clearSearch(cm);
  }

  function getOnReadOnlyCallback(callback) {
    let closeFindDialogOnReadOnly = (cm, opt) => {
      if (opt === 'readOnly' && !!cm.getOption('readOnly')) {
        callback();
        cm.off('optionChange', closeFindDialogOnReadOnly);
      }
    }
    return closeFindDialogOnReadOnly;
  }

  function updateCount(cm) {
    let state = getSearchState(cm);
    let value = cm.getDoc().getValue();
    let globalQuery;
    let queryText = state.queryText;

    if (!queryText || queryText === '') {
      resetCount(cm);
      return;
    }

    while (queryText.charAt(queryText.length - 1) === '\\') {
      queryText = queryText.substring(0, queryText.lastIndexOf('\\'));
    }

    if (typeof state.query === 'string') {
      globalQuery = new RegExp(queryText, 'ig');
    } else {
      globalQuery = new RegExp(state.query.source, state.query.flags + 'g');
    }

    let matches = value.match(globalQuery);
    let count = matches ? matches.length : 0;

    let countText = count === 1 ? '1 match found' : count + ' matches found';
    cm.getWrapperElement().parentNode.querySelector('.CodeMirror-search-count').style.display = 'inline-block';
    cm.getWrapperElement().parentNode.querySelector('.CodeMirror-search-count').innerHTML = countText;
  }

  function resetCount(cm) {
    cm.getWrapperElement().parentNode.querySelector('.CodeMirror-search-count').style.display = 'none';
    cm.getWrapperElement().parentNode.querySelector('.CodeMirror-search-count').innerHTML = '';
  }

  function getFindBehaviour(cm, defaultText, callback) {
    if (!defaultText) {
      defaultText = '';
    }
    let behaviour = {
      value: defaultText,
      focus: true,
      selectValueOnOpen: true,
      closeOnEnter: false,
      closeOnBlur: false,
      callback: (inputs, e) => {
        let query = inputs[0].value;
        if (!query) return;
        doSearch(cm, query, !!e.shiftKey);
      },
      onInput: (inputs, e) => {
        let query = inputs[0].value;
        if (!query) {
          resetCount(cm);
          clearSearch(cm);
          return;
        };
        doSearch(cm, query, !!e.shiftKey, false);
      }
    };
    if (!!callback) {
      behaviour.callback = callback;
    }
    return behaviour;
  }

  function getFindPrevBtnBehaviour(cm) {
    return {
      callback: (inputs) => {
        let query = inputs[0].value;
        if (!query) return;
        doSearch(cm, query, true);
      }
    }
  }

  function getFindNextBtnBehaviour(cm) {
    return {
      callback: (inputs) => {
        let query = inputs[0].value;
        if (!query) return;
        doSearch(cm, query, false);
      }
    }
  }

  function closeBtnBehaviour(cm) {
    return {
      callback: null
    }
  }

  CodeMirror.commands.find = (cm) => {
    if (cm.getOption("readOnly")) return;
    clearSearch(cm);
    let state = getSearchState(cm);
    var query = cm.getSelection() || getSearchState(cm).lastQuery;
    let closeDialog = cm.openToolpanelDialog(findDialog, {
      bottom: false,
      shrinkEditor: true,
      inputBehaviours: [
        getFindBehaviour(cm, query)
      ],
      buttonBehaviours: [
        getFindPrevBtnBehaviour(cm),
        getFindNextBtnBehaviour(cm),
        closeBtnBehaviour
      ],
      onClose: () => {
        closeSearchCallback(cm, state);
      }
    });

    cm.on("optionChange", getOnReadOnlyCallback(closeDialog));
    startSearch(cm, state, query);
    updateCount(cm);
  };

  CodeMirror.commands.replace = (cm, all) => {
    if (cm.getOption("readOnly")) return;
    clearSearch(cm);

    let replaceNextCallback = (inputs) => {
      let query = parseQuery(inputs[0].value);
      let text = parseString(inputs[1].value);
      if (!query) return;
      replaceNext(cm, query, text);
      doSearch(cm, query);
    };

    let state = getSearchState(cm);
    let query = cm.getSelection() || state.lastQuery;
    let closeDialog = cm.openToolpanelDialog(replaceDialog, {
      bottom: false,
      shrinkEditor: true,
      inputBehaviours: [
        getFindBehaviour(cm, query, (inputs) => {
          inputs[1].focus();
          inputs[1].select();
        }),
        {
          closeOnEnter: false,
          closeOnBlur: false,
          callback: replaceNextCallback
        }
      ],
      buttonBehaviours: [
        getFindPrevBtnBehaviour(cm),
        getFindNextBtnBehaviour(cm),
        {
          callback: replaceNextCallback
        },
        {
          callback: (inputs) => {
            // Replace all
            let query = parseQuery(inputs[0].value);
            let text = parseString(inputs[1].value);
            if (!query) return;
            replaceAll(cm, query, text);
          }
        },
        closeBtnBehaviour
      ],
      onClose: () => {
        closeSearchCallback(cm, state);
      }
    });

    cm.on("optionChange", getOnReadOnlyCallback(closeDialog));
    startSearch(cm, state, query);
    updateCount(cm);
  };
})