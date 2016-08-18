var bounceResponses = require('./responses');
var mimelib = require('mimelib');

/* BOUNCE HANDLER Class, Version 7.3
 * Description: "chops up the bounce into associative arrays"
 *     ~ http://www.anti-spam-man.com/php_bouncehandler/v7.3/
 *     ~ https://github.com/cfortune/PHP-Bounce-Handler/
 *     ~ http://www.phpclasses.org/browse/file/11665.html
 */

/* Debugging / Contributers:
 * "Kanon"
 * Jamie McClelland http://mayfirst.org
 * Michael Cooper
 * Thomas Seifert
 * Tim Petrowsky http://neuecouch.de
 * Willy T. Koch http://apeland.no
 * ganeshaspeaks.com - FBL development
 * Richard Catto - FBL development
 * Scott Brynen - FBL development  http://visioncritical.com
 */


/*
 The BSD License
 Copyright (c) 2006-forever, Chris Fortune http://cfortune.kics.bc.ca
 All rights reserved.
 
Redistribution and use in source and binary forms, with or without modification, are permitted provided that the following conditions are met:
 
    * Redistributions of source code must retain the above copyright notice, this list of conditions and the following disclaimer.
    * Redistributions in binary form must reproduce the above copyright notice, this list of conditions and the following disclaimer in the documentation and/or other materials provided with the distribution.
    * Neither the name of the BounceHandler nor the names of its contributors may be used to endorse or promote products derived from this software without specific prior written permission.
 
THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS" AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT OWNER OR CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
*/

const TYPE_HARD = 'hard',
    TYPE_SOFT = 'soft',
    CAUSE_FBL = 'Feedback Loop',
    CAUSE_AUTOREPLY = 'Autoreply',
    CAUSE_AUTORESPONSE = 'Autoresponse';

var BounceHandler = function(eml) {

    /**** VARS ****************************************************************/
    this.head = {};
    this.fbl = [];
    this.body = [];
    this.txtBody = '';
    this.bounceTags = {};
    this.autorespondlist = [];

    this.looksLikeBounce = false;
    this.looksLikeFBL = false;
    this.looksLikeAutoresponse = false;
    this.is_hotmail_fbl = false;

    // these are for feedback reports, so you can extract uids from the emails
    // eg X-my-custom-header: userId12345
    // eg <img src="http://mysite.com/track.php?u=userId12345">
    this.web_beacon_preg_1 = "";
    this.web_beacon_preg_2 = "";
    this.x_header_search_1 = "";
    this.x_header_search_2 = "";

    // accessors
    this.type = "";
    this.web_beacon_1 = "";
    this.web_beacon_2 = "";
    this.feedback_type = "";
    this.feedback_useragent = "";
    this.x_header_beacon_1 = "";
    this.x_header_beacon_2 = "";

    // these accessors are useful only for FBL's
    // or if the output array has only one index
    this.bounceType = "";
    this.bounceCause = "";
    this.subject = "";
    this.recipient = "";

    // the raw data set, a multiArray
    this.output = [];

    /**** INSTANTIATION *******************************************************/
    this.output.push({
        type: '',
        tag: '',
        cause: '',
        description: '',
        recipient: '',
        messageid: ''
    });


    this.handleBounce = function(bounceTags) {
        this.bounceTags = bounceTags || bounceResponses.bounceTags;
        this.autorespondlist = bounceResponses.autorespondlist;

        // parse the email into data structures
        var boundary = this.head['Content-type'] ? this.head['Content-type']['boundary'] : undefined;
        var mimeSections = this.parseBodyIntoMimeSections(this.txtBody, boundary);
        this.firstBodyPart = this.parseHead(mimeSections['first_body_part']);

        this.looksLikeBounce = this.isBounce();
        this.looksLikeFBL = this.isARF();
        this.looksLikeAutoresponse = this.isAutoresponse();

        /* If you are trying to save processing power, and don't care much
         * about accuracy then uncomment this statement in order to skip the
         * heroic text parsing below.
         */
        //if(!this.looksLikeBounce && !this.looksLikeFBL && !this.looksLikeAutoresponse){
        //    return "unknown";
        //}

        /*** now we try all our weird text parsing methods (E-mail is weird!) ******************************/
        if (!this.output.length) {
            this.output.push({
                type: '',
                tag: '',
                cause: '',
                description: '',
                recipient: '',
                messageid: ''
            });
        }

        // is it a Feedback Loop, in Abuse Feedback Reporting Format (ARF)?
        // http://en.wikipedia.org/wiki/Abuse_Reporting_Format#Abuse_Feedback_Reporting_Format_.28ARF.29
        if (this.looksLikeFBL) {
            this.output[0]['type'] = TYPE_SOFT;
            this.output[0]['cause'] = CAUSE_FBL;
            this.subject = this.head['Subject'].replace(/Fw:/gi, "").trim();
            if (this.is_hotmail_fbl === true) {
                // fill in the fbl_hash with sensible values
                this.fbl['Content-disposition'] = 'inline';
                this.fbl['Content-type'] = 'message/feedback-report';
                this.fbl['Feedback-type'] = 'abuse';
                this.fbl['User-agent'] = 'Hotmail FBL';
                if (typeof this.firstBodyPart['Date'] != 'undefined') {
                    this.fbl['Received-date'] = this.firstBodyPart['Date'];
                }
                if (this.recipient) {
                    this.fbl['Original-rcpt-to'] = this.recipient;
                }
                if (typeof this.firstBodyPart['X-sid-pra'] != 'undefined') {
                    this.fbl['Original-mail-from'] = this.firstBodyPart['X-sid-pra'];
                }
            } else {

                this.fbl = this.standardParser(mimeSections['machine_parsable_body_part']);
                var returnedhash = this.standardParser(mimeSections['returned_message_body_part']);
                if (!this.fbl['Original-mail-from'] && returnedhash['From']) {
                    this.fbl['Original-mail-from'] = returnedhash['From'];
                }
                if (!this.fbl['Original-rcpt-to'] && this.fbl['Removal-recipient']) {
                    this.fbl['Original-rcpt-to'] = this.fbl['Removal-recipient'];
                } else if (returnedhash['To']) {
                    this.fbl['Original-rcpt-to'] = returnedhash['To'];
                }

                if (!this.fbl['Original-mail-messageid'] && returnedhash['Message-id']) {
                    this.fbl['Original-mail-messageid'] = returnedhash['Message-id'];
                }

            }
            // warning, some servers will remove the name of the original intended recipient from the FBL report,
            // replacing it with redactedrcpt-hostname.com, making it utterly useless, of course (unless you used a web-beacon).
            // here we try our best to give you the actual intended recipient, if possible.
            if (this.fbl['Original-rcpt-to'].match(/Undisclosed|redacted/i) && typeof this.fbl['Removal-recipient'] != 'undefined') {
                this.fbl['Original-rcpt-to'] = this.fbl['Removal-recipient'];
            }
            if (!this.fbl['Received-date'] && this.fbl['Arrival-date']) {
                this.fbl['Received-date'] = this.fbl['Arrival-date'];
            }
            this.fbl['Original-mail-from'] = this.stripAngleBrackets(this.fbl['Original-mail-from']);
            this.fbl['Original-rcpt-to'] = this.stripAngleBrackets(this.fbl['Original-rcpt-to']);
            this.output[0]['recipient'] = this.fbl['Original-rcpt-to'];
            this.output[0]['messageid'] = this.fbl['Original-mail-messageid'] ? this.fbl['Original-mail-messageid'] : null;
        } else if (this.head['Subject'].match(/auto.{0,20}reply|vacation|(out|away|on holiday).*office/i)) {
            // looks like a vacation autoreply, ignoring
            this.output[0]['type'] = TYPE_SOFT;
            this.output[0]['cause'] = CAUSE_AUTOREPLY;
        }

        // is this an autoresponse ?
        else if (this.looksLikeAutoresponse) {
            this.output[0]['type'] = TYPE_SOFT;
            this.output[0]['cause'] = CAUSE_AUTORESPONSE;
            // grab the first recipient and break
            this.output[0]['recipient'] = typeof(this.head['Return-path']) != 'undefined' ? this.stripAngleBrackets(this.head['Return-path']) : '';
            if (this.output[0]['recipient']) {
                var arrFailed = this.findEmailAddresses(this.txtBody);
                for (j = 0; j < arrFailed.length; j++) {
                    this.output[j]['recipient'] = arrFailed[j].trim();
                    break;
                }
            }
        } else if (this.isRFC1892MultipartReport() === true) {
            var rpt_hash = this.parseMachineParsableBodyPart(mimeSections['machine_parsable_body_part']);
            var rpt_head = this.getHeadFromReturnedMessageBodyPart(mimeSections);
            var recipients = rpt_hash['per_recipient'];

            for (var i = 0; i < recipients.length; i++) {
                var recipient = recipients[i];
                this.output[i] = {};
                this.output[i]['recipient'] = this.findRecipient(recipient);

                var type = TYPE_SOFT,
                    cause = '',
                    tag = '';
                if (recipient['Diagnostic-code'] && recipient['Diagnostic-code'].text) {
                    cause = recipient['Diagnostic-code'].text;
                    tag = this.getHardTag(cause);
                    type = tag ? TYPE_HARD : TYPE_SOFT;
                }


                this.output[i]['type'] = type;
                this.output[i]['tag'] = tag;
                this.output[i]['cause'] = cause;
                this.output[i]['description'] = cause;
                // TODO: Review MessageId associated with each output.
                this.output[i]['messageid'] = rpt_head['MessageId'] ? rpt_head['MessageId'] : '';
            }
        } else if (typeof(this.head['X-failed-recipients']) != 'undefined') {
            //  Busted Exim MTA
            //  Up to 50 email addresses can be listed on each header.
            //  There can be multiple X-Failed-Recipients: headers. - (not supported)
            var arrFailed = this.head['X-failed-recipients'].split(/\,/);
            for (var j = 0; j < arrFailed.length; j++) {
                var recipient = arrFailed[j].trim();
                this.output[j]['recipient'] = recipient;
                var typeAndCause = this.getTypeAndCauseFromRecipientText(recipient, 0);
                this.output[j]['type'] = typeAndCause[0];
                this.output[j]['cause'] = typeAndCause[1];
                this.output[j]['description'] = typeAndCause[2];
                this.output[j]['tag'] = typeAndCause[3];
                this.output[j]['messageid'] = this.getMessageIdFromRecipientText(recipient, 0);
            }
        } else if (typeof(boundary) != 'undefined' && boundary && this.looksLikeBounce) {
            var arrFailed = this.findEmailAddresses(mimeSections['first_body_part']);
            for (var j = 0; j < arrFailed.length; j++) {

                this.output[j]['recipient'] = arrFailed[j].trim();
                var typeAndCause = this.getTypeAndCauseFromRecipientText(this.output[j]['recipient'], 0);
                this.output[j]['type'] = typeAndCause[0];
                this.output[j]['cause'] = typeAndCause[1];
                this.output[j]['description'] = typeAndCause[2];
                this.output[j]['tag'] = typeAndCause[3];
                this.output[j]['messageid'] = this.getMessageIdFromRecipientText(this.output[j]['recipient'], 0);
            }
        } else if (this.looksLikeBounce) {
            // last ditch attempt
            // could possibly produce erroneous output, or be very resource consuming,
            // so be careful.  You should comment out this section if you are very concerned
            // about 100% accuracy or if you want very fast performance.
            // Leave it turned on if you know that all messages to be analyzed are bounces.
            var arrFailed = this.findEmailAddresses(this.txtBody);
            for (var j = 0; j < arrFailed.length; j++) {
                this.output[j]['recipient'] = arrFailed[j].trim();
                var typeAndCause = this.getTypeAndCauseFromRecipientText(this.output[j]['recipient'], 0);
                this.output[j]['type'] = typeAndCause[0];
                this.output[j]['cause'] = typeAndCause[1];
                this.output[j]['description'] = typeAndCause[2];
                this.output[j]['tag'] = typeAndCause[3];
                this.output[j]['messageid'] = this.getMessageIdFromRecipientText(this.output[j]['recipient'], 0);
            }
        }
        // else if()..... add a parser for your MTA here

        // remove empty array indices
        tmp = [];
        for (var i = 0; i < this.output.length; ++i) {
            var arr = this.output[i];
            if (!arr['recipient'] && !arr['type'] && !arr['cause']) {
                continue;
            }
            tmp.push(arr);
        }
        this.output = tmp;

        // accessors
        /*if it is an FBL, you could use the class variables to access the
        data (Unlike Multipart-reports, FBL's report only one bounce)
        */
        this.type = this.findType();
        this.bounceType = this.output.length ? this.output[0]['type'] : '';
        this.bounceCause = this.output.length ? this.output[0]['cause'] : '';
        this.subject = (this.subject) ? this.subject : this.head['Subject'];
        this.recipient = this.output.length ? this.output[0]['recipient'] : '';
        this.messageid = this.output.length ? this.output[0]['messageid'] : '';
        this.feedback_type = this.fbl['Feedback-type'] ? this.fbl['Feedback-type'] : "";
        this.feedback_useragent = this.fbl['User-agent'] ? this.fbl['User-agent'] : "";

        // sniff out any web beacons
        if (this.web_beacon_preg_1)
            this.web_beacon_1 = this.findWebBeacon(this.txtBody, this.web_beacon_preg_1);
        if (this.web_beacon_preg_2)
            this.web_beacon_2 = this.findWebBeacon(this.txtBody, this.web_beacon_preg_2);
        if (this.x_header_search_1)
            this.x_header_beacon_1 = this.findXHeader(this.x_header_search_1);
        if (this.x_header_search_2)
            this.x_header_beacon_2 = this.findXHeader(this.x_header_search_2);

        return this.output;
    }



    this.initBouncehandler = function(blob, format) {
        if (typeof format == 'undefined') format = 'string';

        this.head = {};
        this.fbl = [];
        this.body = [];
        this.txtBody = '';
        this.looksLikeBounce = false;
        this.looksLikeFBL = false;
        this.is_hotmail_fbl = false;
        this.type = "";
        this.feedback_type = "";
        this.bounceType = "";
        this.bounceCause = "";
        this.subject = "";
        this.recipient = "";
        this.output = [];

        // TODO: accept several formats (XML, string, array)
        // currently accepts only string
        //if(format=='xml_array'){
        //    strEmail = "";
        //    out = "";
        //    for(i=0; i<blob; i++){
        //        out = preg_replace("/<HEADER>/i", "", blob[i]);
        //        out = preg_replace("/</HEADER>/i", "", out);
        //        out = preg_replace("/<MESSAGE>/i", "", out);
        //        out = preg_replace("/</MESSAGE>/i", "", out);
        //        out = rtrim(out) . "\r\n";
        //        strEmail .= out;
        //    }
        //}
        //else if(format=='string'){

        strEmail = blob.replace(/\r\n/g, "\n"); // line returns 1
        strEmail = strEmail.replace(/\n/g, "\r\n"); // line returns 2
        strEmail = strEmail.replace(/=\r\n/g, ""); // remove MIME line breaks
        strEmail = strEmail.replace(/=3D/g, "="); // equals sign =
        strEmail = strEmail.replace(/=09/g, "  "); // tabs

        //}
        //else if(format=='array'){
        //    strEmail = "";
        //    for(i=0; i<blob; i++){
        //        strEmail .= rtrim(blob[i]) . "\r\n";
        //    }
        //}

        return strEmail;
    }

    // general purpose recursive heuristic function
    // to try to extract useful info from the bounces produced by busted MTAs
    this.getMessageIdFromRecipientText = function(recipient, index) {
            var messageid = '';
            for (var i = index; i < this.body.length; i++) {
                line = this.body[i].trim();
                if (line.length < 1) {
                    continue;
                }

                if (line.toLowerCase().indexOf('Message-ID'.toLowerCase()) == 0) {
                    var splits = line.split(':');
                    messageid = splits[1].trim();
                    break;
                }

                /***** retry bounce email might not have Message-ID instead may have status line *****/
                if (!messageid) {
                    var matches = line.match(/message identifier[^:]+:(.*)/);
                    if (matches) {
                        messageid = matches[1].trim();
                    }
                }

            }
            return messageid;
        },

        // general purpose recursive heuristic function
        // to try to extract useful info from the bounces produced by busted MTAs
        this.getTypeAndCauseFromRecipientText = function(recipient, index) {
            var type, cause, tag = null,
                discription = '';
            for (var i = index; i < this.body.length; i++) {
                var line = this.body[i];
                line = line.trim();

                if (line.length == 0) {
                    continue;
                }

                lowerLine = line.toLowerCase();
                /******** recurse into the email if you find the recipient ********/
                if (lowerLine.indexOf(recipient.toLowerCase()) != -1 && index == 0) {
                    // the status code MIGHT be in the next few lines after the recipient line,
                    // depending on the message from the foreign host... What a laugh riot!
                    var typeAndCause = this.getTypeAndCauseFromRecipientText(recipient, i + 1);
                    if (typeAndCause) {
                        return typeAndCause;
                    }
                }

                /******** exit conditions ********/
                // if it's the end of the human readable part in this stupid bounce
                if (lowerLine.indexOf('------ this is a copy of the message') != -1) {
                    break;
                }

                if (lowerLine.indexOf('--- original message') != -1) {
                    break;
                }

                if (lowerLine.indexOf('-- below this line is a copy of the message') != -1) {
                    break;
                }

                if (lowerLine.indexOf('here is your returned mail') != -1) {
                    break;
                }

                if (lowerLine.indexOf('transcript of session follows') != -1) {
                    break;
                }

                if (lowerLine.indexOf('original message follows') != -1) {
                    break;
                }

                if (lowerLine.indexOf('end of message') != -1) {
                    break;
                }

                if (lowerLine.indexOf('message text follows:') != -1) {
                    break;
                }

                if (lowerLine.indexOf('--- below the next line is a copy of the message.') != -1) {
                    break;
                }

                if (lowerLine.indexOf('--- session transcript ---') != -1) {
                    break;
                }

                if (lowerLine.indexOf('--------returned mail follows--------') != -1) {
                    break;
                }

                if (lowerLine.indexOf('original message attached') != -1) {
                    break;
                }

                if (lowerLine.indexOf('your message reads') != -1) {
                    break;
                }
                if (lowerLine.indexOf('a copy of the original message') != -1) {
                    break;
                }

                if (lowerLine.indexOf('---- start of returned message ----') != -1) {
                    break;
                }

                //if we see an email address other than our current recipient's,
                if (this.findEmailAddresses(line).length >= 1 && lowerLine.indexOf(recipient.toLowerCase()) == -1 && line.indexOf('FROM:<') == -1) { // Kanon added this line because Hotmail puts the e-mail address too soon and there actually is error message stuff after it.
                    break;
                }

                //if we find a header
                if (line.match(/^([^\s.]*):\s*(.*)\s*/)) {
                    break;
                }

                discription += line;

                var hardTag = this.getHardTag(line);
                if (hardTag) {
                    type = TYPE_HARD;
                    cause = line;
                    tag = hardTag;
                }

            }
            if (!type) {
                type = TYPE_SOFT;
                cause = discription;
            }
            return [type, cause, discription, tag];
        }

    this.getHardTag = function(text) {
        if (text.length) { // a bit-optimized to ignore scanning over blank lines
            for (var idx in this.bounceTags.hard) {
                var bouncetext = this.bounceTags.hard[idx];
                var matches = text.match(new RegExp(bouncetext, "ig"));
                if (matches) {
                    return bouncetext;
                }
            }
        }
        return null;
    }

    this.isRFC1892MultipartReport = function() {
        return this.head['Content-type'] && this.head['Content-type']['type'] == 'multipart/report' && this.head['Content-type']['report-type'] == 'delivery-status' && this.head['Content-type']['boundary'] !== '';
    }

    this.parseHead = function(headers) {
        if (typeof headers == 'string') headers = headers.split("\r\n");

        var hash = this.standardParser(headers);
        if (hash['Content-type']) { //preg_match('/Multipart\/Report/i', hash['Content-type'])){
            var multipart_report = hash['Content-type'].split(';');
            hash['Content-type'] = {};
            hash['Content-type']['type'] = multipart_report[0].toLowerCase();
            for (var i = 0; i < multipart_report.length; ++i) {
                var mr = multipart_report[i];
                var matches = mr.match(/([^=.]*?)=(.*)/i);
                if (matches) {
                    // didn't work when the content-type boundary ID contained an equal sign,
                    // that exists in bounces from many Exchange servers
                    //if(preg_match('/([a-z]*)=(.*)?/i', mr, matches)){
                    hash['Content-type'][matches[1].trim().toLowerCase()] = matches[2].replace(/"/g, '');
                }
            }
        }
        return hash;
    }

    this.parseBodyIntoMimeSections = function(body, boundary) {
        if (!boundary) return [];
        if (typeof body == 'object' && typeof body.length != 'undefined') body = body.join("\r\n");
        body = body.split(boundary);
        var mimeSections = {};
        mimeSections['first_body_part'] = body[1];
        mimeSections['machine_parsable_body_part'] = body[2];
        mimeSections['returned_message_body_part'] = body[3];
        return mimeSections;
    }


    this.standardParser = function(content) { // associative array orstr
        // receives email head as array of lines
        // simple parse (Entity: value\n)
        var hash = { 'Received': '' }
        if (typeof content == 'undefined') content = [];
        if (typeof content == 'string') content = content.split("\r\n");

        for (var i = 0; i < content.length; ++i) {
            var line = content[i];
            var array = line.match(/^([^\s.]*):\s*(.*)\s*/);
            if (array) {
                var entity = array[1].toLowerCase();
                entity = entity.charAt(0).toUpperCase() + entity.slice(1);

                if (!hash[entity]) {
                    hash[entity] = array[2].trim();
                } else if (hash['Received']) {
                    // grab extra Received headers :(
                    // pile it on with pipe delimiters,
                    // oh well, SMTP is broken in this way
                    if (entity && array[2] && array[2] != hash[entity]) {
                        hash[entity] += "|" + array[2].trim();
                    }
                }
            } else if (line.match(/^\s+(.+)\s*/) && entity) {
                hash[entity] += ' ' + line;
            }
        }
        // special formatting
        hash['Received'] = hash['Recieved'] ? hash['Recieved'].split('|') : '';
        //hash['Subject'] = iconv_mime_decode(hash['Subject'], 0, "ISO-8859-1"); // REVIEW <<<<

        return hash;
    }

    this.parseMachineParsableBodyPart = function(str) {
        //Per-Message DSN fields
        var hash = this.parseDSNFields(str);
        hash['mime_header'] = this.standardParser(hash['mime_header']);
        hash['per_message'] = this.standardParser(hash['per_message']);
        if (hash['per_message']['X-postfix-sender']) {
            var arr = hash['per_message']['X-postfix-sender'].split(';');
            hash['per_message']['X-postfix-sender'] = '';
            hash['per_message']['X-postfix-sender']['type'] = arr[0].trim();
            hash['per_message']['X-postfix-sender']['addr'] = arr[1].trim();
        }
        if (hash['per_message']['Reporting-mta']) {
            var arr = hash['per_message']['Reporting-mta'].split(';');
            hash['per_message']['Reporting-mta'] = '';
            hash['per_message']['Reporting-mta']['type'] = arr[0].trim();
            hash['per_message']['Reporting-mta']['addr'] = arr[1].trim();
        }
        //Per-Recipient DSN fields
        for (i = 0; i < hash['per_recipient'].length; i++) {
            var temp = this.standardParser(hash['per_recipient'][i].split("\r\n"));
            var arr = temp['Final-recipient'] ? temp['Final-recipient'].split(';') : [];
            temp['Final-recipient'] = this.formatFinalRecipientArray(arr);
            //temp['Final-recipient']['type'] = trim(arr[0]);
            //temp['Final-recipient']['addr'] = trim(arr[1]);
            arr = (temp['Original-recipient']) ? temp['Original-recipient'].split(';') : ['', ''];
            temp['Original-recipient'] = {};
            temp['Original-recipient']['type'] = arr[0].trim();
            temp['Original-recipient']['addr'] = arr[1].trim();
            arr = (temp['Diagnostic-code']) ? temp['Diagnostic-code'].split(';') : ['', ''];
            temp['Diagnostic-code'] = {};
            temp['Diagnostic-code']['type'] = arr[0].trim();
            temp['Diagnostic-code']['text'] = arr[1].trim();
            // now this is wierd: plenty of times you see the status code is a permanent failure,
            // but the diagnostic code is a temporary failure.  So we will assert the most general
            // temporary failure in this case.
            var ddc = '';
            var judgement = '';
            ddc = this.decodeDiagnosticCode(temp['Diagnostic-code']['text']);
            judgement = this.getActionFromStatusCode(ddc);
            if (judgement == 'transient') {
                if (temp['Action'].toLowerCase().indexOf('failed') != -1) {
                    temp['Action'] = 'transient';
                    temp['Status'] = '4.3.0';
                }
            }
            hash['per_recipient'][i] = '';
            hash['per_recipient'][i] = temp;
        }
        return hash;
    }

    this.getHeadFromReturnedMessageBodyPart = function(mimeSections) {
        var head = {};
        if (mimeSections['returned_message_body_part']) {
            var temp = mimeSections['returned_message_body_part'].split("\r\n\r\n");
            head = this.standardParser(temp[1]);
            head['From'] = this.extractAddress(head['From']);
            head['To'] = this.extractAddress(head['To']);
            head['MessageId'] = head['Message-id'];
        }
        return head;
    }

    this.extractAddress = function(str) {
        var from_stuff = str ? str.split(/[ \"\'\<\>:\(\)\[\]]/) : [];
        var from = null;
        for (var i = 0; i < from_stuff.length; ++i) {
            var things = from_stuff[i];
            if (things.indexOf('@') != -1) { from = things; }
        }
        return from;
    }

    this.findRecipient = function(per_rcpt) {
        var recipient = '';
        if (per_rcpt['Original-recipient'] && per_rcpt['Original-recipient']['addr'] !== '') {
            recipient = per_rcpt['Original-recipient']['addr'];
        } else if (per_rcpt['Final-recipient'] && per_rcpt['Final-recipient']['addr'] !== '') {
            recipient = per_rcpt['Final-recipient']['addr'];
        }
        recipient = this.stripAngleBrackets(recipient);
        return recipient;
    }

    this.findType = function() {
        if (this.looksLikeBounce)
            return "bounce";
        else if (this.looksLikeFBL)
            return "fbl";
        else
            return false;
    }

    this.parseDSNFields = function(dsn_fields) {
        if (typeof dsn_fields == 'undefined') dsn_fields = [];
        else if (typeof dsn_fields == 'string') dsn_fields = dsn_fields.split(/\r\n\r\n/g);
        var j = 0;
        var hash = {
            'per_message': '',
            'per_recipient': []
        };
        for (var i = 0; i < dsn_fields.length; i++) {
            dsn_fields[i] = dsn_fields[i].trim();
            if (i == 0)
                hash['mime_header'] = dsn_fields[0];
            else if (i == 1 && !dsn_fields[1].match(/(Final|Original)-Recipient/)) {
                // some mta's don't output the per_message part, which means
                // the second element in the array should really be
                // per_recipient - test with Final-Recipient - which should always
                // indicate that the part is a per_recipient part
                hash['per_message'] = dsn_fields[1];
            } else {
                if (dsn_fields[i] == '--') continue;
                hash['per_recipient'][j] = dsn_fields[i];
                j++;
            }
        }
        return hash;
    }

    this.formatStatusCode = function(code) {
        var ret = {};
        var matches = code.match(/([245])\.([01234567])\.([012345678])(.*)/);
        if (matches) {
            ret['code'] = [matches[1], matches[2], matches[3]];
            ret['text'] = matches[4];
        } else {
            matches = code.match(/([245])([01234567])([012345678])(.*)/);
            if (matches) {
                ret['code'] = [matches[1], matches[2], matches[3]];
                ret['text'] = matches[4];
            }
        }
        return ret;
    }

    this.fetchStatusMessages = function(code) {
        var rfc1893 = require('./rfc1893-error-codes');
        var ret = this.formatStatusCode(code);
        var arr = ret['code'];
        var str = "<P><B>" + rfc1893.status_code_classes[arr[0]]['title'] + "</B> - " + rfc1893.status_code_classes[arr[0]]['descr'] + "  <B>" + rfc1893.status_code_subclasses[arr[1] + "." + arr[2]]['title'] + "</B> - " + rfc1893.status_code_subclasses[arr[1] + "." + arr[2]]['descr'] + "</P>";
        return str;
    }

    this.getActionFromStatusCode = function(code) {
        if (code == '') return '';
        var ret = this.formatStatusCode(code);
        code = ret.code;
        var stat = parseInt(code[0]);
        switch (stat) {
            case 2:
                return 'success';
            case 4:
                return 'transient';
            case 5:
                if (code[1] == 7 && code[2] == 1) {
                    return 'transient';
                } else {
                    return 'failed';
                }
            default:
                return 'unknown';
        }
    }

    this.decodeDiagnosticCode = function(dcode) {
        if (!dcode) return '';
        var array = dcode.match(/(\d\.\d\.\d)\s/);
        if (array) {
            return array[1];
        } else {
            array = dcode.match(/(\d\d\d)\s/);
            if (array) {
                return array[1];
            }
        }
    }

    this.isBounce = function() {
        if (this.head['Subject'].match(/(mail delivery failed|failure notice|warning: message|delivery status notif|delivery failure|delivery problem|spam eater|returned mail|undeliverable|returned mail|delivery errors|mail status report|mail system error|failure delivery|delivery notification|delivery has failed|undelivered mail|returned email|returning message to sender|returned to sender|message delayed|mdaemon notification|mailserver notification|mail delivery system|nondeliverable mail|mail transaction failed)|auto.{0,20}reply|vacation|(out|away|on holiday).*office/i)) return true;
        if (this.head['Precedence'] && this.head['Precedence'].match(/auto_reply/)) return true;
        if (this.head['From'] && this.head['From'].match(/^(postmaster|mailer-daemon)\@?/i)) return true;
        return false;
    }

    this.findEmailAddresses = function(first_body_part) {
        // not finished yet.  This finds only one address.
        var matches = first_body_part.match(/\b([A-Z0-9._%-]+@[A-Z0-9.-]+\.[A-Z]{2,4})\b/i);
        if (matches) {
            return [matches[1]];
        } else
            return [];
    }


    // these functions are for feedback loops
    this.isARF = function() {
        if (this.head['Content-type'] && this.head['Content-type']['report-type'] && this.head['Content-type']['report-type'].match(/feedback-report/)) return true;
        if (this.head['X-loop'] && this.head['X-loop'].match(/scomp/)) return true;
        if (typeof this.head['X-hmxmroriginalrecipient'] != 'undefined') {
            this.is_hotmail_fbl = true;
            this.recipient = this.head['X-hmxmroriginalrecipient'];
            return true;
        }
        if (typeof this.firstBodyPart['X-hmxmroriginalrecipient'] != 'undefined') {
            this.is_hotmail_fbl = true;
            this.recipient = this.firstBodyPart['X-hmxmroriginalrecipient'];
            return true;
        }
        return false;
    }

    // look for common auto-responders
    this.isAutoresponse = function() {
        var matches = this.head['Subject'].match(/^=\?utf-8\?B\?(.*?)\?=/);
        if (matches)
            subj = mimelib.decodeBase64(matches[1]);
        else
            subj = this.head['Subject'];
        for (var i = 0; i < this.autorespondlist.length; ++i) {
            var a = this.autorespondlist[i];
            if (subj.match(new RegExp("/" + a + "/", "i"))) {
                //echo "a , subj"; exit;
                this.autoresponse = this.head['Subject'];
                return true;
            }
        }
        return false;
    }



    // use a perl regular expression to find the web beacon
    this.findWebBeacon = function(body, preg) {
        if (typeof preg == 'undefined' || !preg)
            return "";
        var matches = body.match(preg);
        if (matches)
            return matches[1];
    }

    this.findXHeader = function(xheader) {
        var xheader = ucfirst(strtolower(xheader));
        // check the header
        if (typeof this.head[xheader] != 'undefined') {
            return this.head[xheader];
        }
        // check the body too
        var tmp_body_hash = this.standardParser(this.body);
        if (typeof(tmp_body_hash[xheader]) != 'undefined') {
            return tmp_body_hash[xheader];
        }
        return "";
    }

    this.findFBLRecipients = function(fbl) {
        if (typeof(fbl['Original-rcpt-to']) != 'undefined') {
            return fbl['Original-rcpt-to'];
        } else if (typeof(fbl['Removal-recipient']) != 'undefined') {
            return fbl['Removal-recipient'].replace(/--/g, '').trim();
        }
        //else if(){
        //}
        //else {
        //}
    }

    this.stripAngleBrackets = function(recipient) {
        if (!recipient) return recipient;
        recipient = recipient.replace(/</g, '');
        recipient = recipient.replace(/>/g, '');
        return recipient.trim();
    }


    /*The syntax of the final-recipient field is as follows:
    "Final-Recipient" ":" address-type ";" generic-address
    */
    this.formatFinalRecipientArray = function(arr) {
        var output = {
            'addr': '',
            'type': ''
        };
        if (arr.length) {
            if (arr[0].indexOf('@') != -1) {
                output['addr'] = this.stripAngleBrackets(arr[0]);
                output['type'] = (arr[1]) ? arr[1].trim() : 'unknown';
            } else {
                output['type'] = arr[0].trim();
                output['addr'] = this.stripAngleBrackets(arr[1]);
            }
        }

        return output;
    }

    eml = this.initBouncehandler(eml);
    var headAndBody = eml.split(/\r\n\r\n/);
    var head = headAndBody.shift();
    this.txtBody = headAndBody.join("\r\n\r\n");

    this.head = this.parseHead(head);
    this.body = this.txtBody.split(/\r\n/);

} /** END class BounceHandler **/

exports.BounceHandler = BounceHandler;
